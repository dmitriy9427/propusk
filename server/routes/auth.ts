/**
 * /api/auth — всё, что нужно ДО входа: регистрация, вход, второй шаг,
 * обновление токенов, выход, вход по ссылке, сброс пароля, вход по passkey.
 */
import { Hono } from 'hono'
import { z } from 'zod'

import { emailSchema, loginSchema, passwordSchema, recoveryCodeSchema, registerSchema, totpCodeSchema } from '../../shared/schemas.ts'
import { CONFIG } from '../config.ts'
import type { AppEnv, Deps } from '../context.ts'
import {
  audit,
  consumeEmailToken,
  endSessionByCookie,
  issueEmailToken,
  link,
  revokeAllSessions,
  rotateRefresh,
  sendMail,
  startSession,
  userAgent,
} from '../core.ts'
import type { User } from '../db.ts'
import { hashPassword, randomId, randomToken, sha256, verifyPassword } from '../lib/crypto.ts'
import { ApiError, parseBody, unauthorized } from '../lib/http.ts'
import { authenticationOptions, verifyAuthentication } from '../lib/passkeys.ts'
import { createRateLimiter } from '../lib/rate-limit.ts'
import { verifyTotp } from '../lib/totp.ts'

const findByEmail = (deps: Deps, email: string) => deps.db.data.users.find((u) => u.email === email)

/**
 * Одна и та же ошибка для «нет такой почты» и «неверный пароль». Иначе по
 * ответу можно перебором выяснить, кто зарегистрирован в сервисе.
 */
const INVALID = () => new ApiError(401, 'invalid-credentials', 'Неверная почта или пароль')

/**
 * Хеш-заглушка: если почты нет, всё равно считаем PBKDF2. Иначе ответ «нет
 * такой почты» приходил бы мгновенно, а «неверный пароль» — через полсекунды,
 * и разницу можно измерить.
 */
let dummyHash: Promise<string> | null = null

export function authRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()
  // Отдельные лимиты: письма (чтобы не заспамить чужую почту) и попытки входа.
  const mailLimit = createRateLimiter(5, 10 * 60, deps.now)
  const loginLimit = createRateLimiter(20, 10 * 60, deps.now)
  const mfaLimit = createRateLimiter(5, 5 * 60, deps.now)
  const iterations = deps.pbkdf2Iterations ?? CONFIG.pbkdf2Iterations

  // ─── Регистрация и подтверждение почты ──────────────────────────────────────

  app.post('/register', async (c) => {
    const { email, name, password } = await parseBody(c, registerSchema)
    mailLimit(`mail:${email}`)
    const existing = findByEmail(deps, email)
    if (existing) {
      // Не говорим «почта занята» — это раскрыло бы, что человек у нас есть.
      // Владельцу почты придёт письмо, ответ — тот же, что при успехе.
      sendMail(deps, email, 'Попытка регистрации', 'Кто-то пытался зарегистрироваться с вашей почтой. Если это вы — просто войдите или восстановите пароль.', `${deps.appUrl}/login`)
      return c.json({ ok: true }, 201)
    }
    const user: User = {
      id: randomId(),
      email,
      name,
      emailVerified: false,
      passwordHash: await hashPassword(password, iterations),
      role: 'user',
      blocked: false,
      createdAt: deps.now(),
      totp: null,
      pendingTotpSecret: null,
      recoveryCodes: [],
      failedLogins: 0,
      lockedUntil: 0,
      identities: [],
    }
    deps.db.data.users.push(user)
    deps.db.changed()
    audit(deps, user.id, 'register', userAgent(c))
    const token = await issueEmailToken(deps, user.id, 'verify', CONFIG.verifyEmailTtlSec)
    sendMail(deps, email, 'Подтвердите почту', `${name}, подтвердите почту, чтобы войти в Пропуск.`, link(deps, '/verify-email', token))
    return c.json({ ok: true }, 201)
  })

  app.post('/verify-email', async (c) => {
    const { token } = await parseBody(c, z.object({ token: z.string().min(1) }))
    const user = await consumeEmailToken(deps, token, 'verify')
    if (!user.emailVerified) {
      user.emailVerified = true
      deps.db.changed()
      audit(deps, user.id, 'email-verified', userAgent(c))
    }
    return c.json({ ok: true, email: user.email })
  })

  app.post('/resend-verification', async (c) => {
    const { email } = await parseBody(c, z.object({ email: emailSchema }))
    mailLimit(`mail:${email}`)
    const user = findByEmail(deps, email)
    if (user && !user.emailVerified) {
      const token = await issueEmailToken(deps, user.id, 'verify', CONFIG.verifyEmailTtlSec)
      sendMail(deps, email, 'Подтвердите почту', 'Новая ссылка для подтверждения почты.', link(deps, '/verify-email', token))
    }
    return c.json({ ok: true })
  })

  // ─── Вход по паролю ─────────────────────────────────────────────────────────

  app.post('/login', async (c) => {
    const { email, password } = await parseBody(c, loginSchema)
    loginLimit(`login:${email}`)
    const user = findByEmail(deps, email)

    if (!user?.passwordHash) {
      dummyHash ??= hashPassword('dummy-password', iterations)
      await verifyPassword(password, await dummyHash)
      throw INVALID()
    }

    // Блокировка после серии неудач: паузы растут 30 с, 60 с, 120 с…
    if (user.lockedUntil > deps.now()) {
      const retryAfter = Math.ceil((user.lockedUntil - deps.now()) / 1000)
      throw new ApiError(429, 'locked', `Слишком много неудачных попыток. Подождите ${retryAfter} с`, undefined, retryAfter)
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      user.failedLogins++
      const over = user.failedLogins - CONFIG.maxFailedLogins
      if (over >= 0) {
        user.lockedUntil = deps.now() + CONFIG.lockoutBaseSec * 1000 * 2 ** over
        audit(deps, user.id, 'locked', userAgent(c), `${user.failedLogins} неудачных попыток`)
      } else {
        audit(deps, user.id, 'login-failed', userAgent(c))
      }
      deps.db.changed()
      throw INVALID()
    }

    // Пароль верный — теперь можно честно сказать, что не так.
    if (user.blocked) throw new ApiError(403, 'blocked', 'Учётная запись заблокирована администратором')
    if (!user.emailVerified) throw new ApiError(403, 'email-not-verified', 'Сначала подтвердите почту — ссылка в письме')

    if (user.totp) return c.json(await mfaTicket(deps, c.req.header('user-agent') ?? '', user, 'password'))
    return c.json(await startSession(c, user, 'password'))
  })

  /**
   * Второй шаг. После пароля клиент получил билет (ticket) — одноразовый,
   * на 5 минут. С ним и кодом из приложения (или кодом восстановления) —
   * сюда. Без билета код бесполезен: сначала нужен пароль.
   */
  app.post('/login/mfa', async (c) => {
    const body = await parseBody(
      c,
      z.object({ ticket: z.string().min(1), code: totpCodeSchema.optional(), recoveryCode: recoveryCodeSchema.optional() }),
    )
    mfaLimit(`mfa:${body.ticket}`)
    const hash = await sha256(body.ticket)
    const tickets = deps.db.data.mfaTickets
    const ticket = tickets.find((t) => t.hash === hash && t.expiresAt > deps.now())
    const user = ticket && deps.db.data.users.find((u) => u.id === ticket.userId)
    if (!ticket || !user?.totp) throw new ApiError(401, 'mfa-expired', 'Время на ввод кода вышло — войдите заново')

    if (body.code) {
      const counter = await verifyTotp(user.totp.secret, body.code, deps.now(), user.totp.lastCounter)
      if (counter === null) throw new ApiError(401, 'mfa-invalid', 'Код не подошёл', { code: 'Код не подошёл — проверьте время на телефоне' })
      user.totp.lastCounter = counter // этот код больше не примем
    } else if (body.recoveryCode) {
      const codeHash = await sha256(body.recoveryCode)
      const index = user.recoveryCodes.indexOf(codeHash)
      if (index < 0) throw new ApiError(401, 'mfa-invalid', 'Код не подошёл', { recoveryCode: 'Такого кода нет или он уже использован' })
      user.recoveryCodes.splice(index, 1)
      audit(deps, user.id, 'recovery-used', userAgent(c), `осталось ${user.recoveryCodes.length}`)
      sendMail(deps, user.email, 'Использован код восстановления', `Вход по коду восстановления. Осталось кодов: ${user.recoveryCodes.length}.`, `${deps.appUrl}/security`)
    } else {
      throw new ApiError(400, 'invalid', 'Введите код', { code: 'Введите код' })
    }

    deps.db.data.mfaTickets = tickets.filter((t) => t !== ticket)
    deps.db.changed()
    return c.json(await startSession(c, user, ticket.method === 'password' ? 'password+totp' : ticket.method))
  })

  // ─── Обновление токенов и выход ──────────────────────────────────────────────

  /**
   * Refresh-токен лежит в cookie, а cookie браузер подставляет сам — даже в
   * запрос, который сделал чужой сайт (это и есть CSRF). Защита в два слоя:
   *   1. SameSite=Strict — браузер не пошлёт cookie с чужого сайта;
   *   2. обязательный заголовок X-Propusk: 1 — чужой сайт не может добавить
   *      свой заголовок в запрос к нам без разрешения CORS.
   */
  app.post('/refresh', async (c) => {
    if (c.req.header('x-propusk') !== '1') throw new ApiError(403, 'csrf', 'Нет заголовка X-Propusk')
    return c.json(await rotateRefresh(c))
  })

  app.post('/logout', async (c) => {
    if (c.req.header('x-propusk') !== '1') throw new ApiError(403, 'csrf', 'Нет заголовка X-Propusk')
    await endSessionByCookie(c)
    return c.json({ ok: true })
  })

  // ─── Вход по ссылке из письма ────────────────────────────────────────────────

  app.post('/magic-link', async (c) => {
    const { email } = await parseBody(c, z.object({ email: emailSchema }))
    mailLimit(`mail:${email}`)
    const user = findByEmail(deps, email)
    if (user?.emailVerified && !user.blocked) {
      const token = await issueEmailToken(deps, user.id, 'magic', CONFIG.emailLinkTtlSec)
      sendMail(deps, email, 'Вход в Пропуск', 'Нажмите, чтобы войти. Ссылка работает 15 минут и один раз.', link(deps, '/magic', token))
    }
    // Ответ одинаковый, есть такая почта или нет.
    return c.json({ ok: true })
  })

  app.post('/magic-link/verify', async (c) => {
    const { token } = await parseBody(c, z.object({ token: z.string().min(1) }))
    const user = await consumeEmailToken(deps, token, 'magic')
    if (user.blocked) throw new ApiError(403, 'blocked', 'Учётная запись заблокирована администратором')
    // Перешёл по ссылке — значит, почта точно его.
    if (!user.emailVerified) user.emailVerified = true
    // Ссылка заменяет пароль, но не второй фактор.
    if (user.totp) return c.json(await mfaTicket(deps, c.req.header('user-agent') ?? '', user, 'magic-link'))
    return c.json(await startSession(c, user, 'magic-link'))
  })

  // ─── Сброс пароля ────────────────────────────────────────────────────────────

  app.post('/password/forgot', async (c) => {
    const { email } = await parseBody(c, z.object({ email: emailSchema }))
    mailLimit(`mail:${email}`)
    const user = findByEmail(deps, email)
    if (user && !user.blocked) {
      const token = await issueEmailToken(deps, user.id, 'reset', CONFIG.emailLinkTtlSec)
      sendMail(deps, email, 'Сброс пароля', 'Нажмите, чтобы задать новый пароль. Если это не вы — ничего не делайте.', link(deps, '/reset-password', token))
    }
    return c.json({ ok: true })
  })

  app.post('/password/reset', async (c) => {
    const { token, password } = await parseBody(c, z.object({ token: z.string().min(1), password: passwordSchema }))
    const user = await consumeEmailToken(deps, token, 'reset')
    user.passwordHash = await hashPassword(password, iterations)
    user.emailVerified = true
    user.failedLogins = 0
    user.lockedUntil = 0
    // Пароль могли сбросить, потому что его украли: завершаем ВСЕ сессии.
    revokeAllSessions(deps, user.id, 'Пароль сброшен')
    deps.db.changed()
    audit(deps, user.id, 'password-reset', userAgent(c))
    sendMail(deps, user.email, 'Пароль изменён', 'Пароль сброшен, все устройства вышли из аккаунта.', `${deps.appUrl}/login`)
    return c.json({ ok: true })
  })

  // ─── Вход по passkey ─────────────────────────────────────────────────────────

  app.post('/passkey/options', async (c) => c.json(await authenticationOptions(deps)))

  app.post('/passkey/verify', async (c) => {
    const body = await parseBody(c, z.object({ challengeId: z.string(), response: z.any() }))
    const passkey = await verifyAuthentication(deps, body.challengeId, body.response)
    const user = deps.db.data.users.find((u) => u.id === passkey.userId)
    if (!user) throw unauthorized()
    if (user.blocked) throw new ApiError(403, 'blocked', 'Учётная запись заблокирована администратором')
    // Passkey — сам по себе два фактора: устройство (что есть) + отпечаток или PIN (кто вы).
    return c.json(await startSession(c, user, 'passkey'))
  })

  return app
}

/** Билет второго шага: в ответе — сам билет, в базе — хеш. */
export async function mfaTicket(deps: Deps, ua: string, user: User, method: 'password' | 'magic-link' | 'romashka') {
  const ticket = randomToken()
  const now = deps.now()
  deps.db.data.mfaTickets = deps.db.data.mfaTickets.filter((t) => t.expiresAt > now)
  deps.db.data.mfaTickets.push({ hash: await sha256(ticket), userId: user.id, method, userAgent: ua, expiresAt: now + CONFIG.mfaTicketTtlSec * 1000 })
  deps.db.changed()
  return { mfaRequired: true as const, ticket }
}
