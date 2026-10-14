/**
 * /api/me — всё о себе для вошедшего пользователя: профиль, устройства,
 * пароль, двухфакторная защита, ключи доступа, журнал событий.
 *
 * Опасные действия защищены «режимом судо» (requireRecentAuth): даже с
 * действующей сессией нужно заново подтвердить личность, если с последнего
 * подтверждения прошло больше 5 минут.
 */
import { Hono } from 'hono'
import { z } from 'zod'

import { nameSchema, passwordSchema, totpCodeSchema } from '../../shared/schemas.ts'
import { CONFIG } from '../config.ts'
import type { AppEnv, Deps } from '../context.ts'
import { audit, publicUser, requireAuth, requireRecentAuth, revokeAllSessions, revokeSession, sendMail, userAgent } from '../core.ts'
import { hashPassword, sha256, verifyPassword } from '../lib/crypto.ts'
import { ApiError, parseBody } from '../lib/http.ts'
import { registrationOptions, verifyAuthentication, verifyRegistration, authenticationOptions } from '../lib/passkeys.ts'
import { createRateLimiter } from '../lib/rate-limit.ts'
import { generateRecoveryCodes, generateTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.ts'

export function meRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()
  const iterations = deps.pbkdf2Iterations ?? CONFIG.pbkdf2Iterations
  const stepUpLimit = createRateLimiter(10, 10 * 60, deps.now)
  app.use(requireAuth)

  app.get('/', (c) => c.json(publicUser(deps, c.var.user)))

  app.patch('/', async (c) => {
    const { name } = await parseBody(c, z.object({ name: nameSchema }))
    c.var.user.name = name
    deps.db.changed()
    return c.json(publicUser(deps, c.var.user))
  })

  // ─── Устройства (сессии) ───────────────────────────────────────────────────

  app.get('/sessions', (c) => {
    const now = deps.now()
    const list = deps.db.data.sessions
      .filter((s) => s.userId === c.var.user.id && !s.revokedAt && s.expiresAt > now)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        method: s.method,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        current: s.id === c.var.session.id,
      }))
    return c.json(list)
  })

  app.delete('/sessions/:id', (c) => {
    const session = deps.db.data.sessions.find((s) => s.id === c.req.param('id') && s.userId === c.var.user.id)
    if (!session) throw new ApiError(404, 'not-found', 'Устройство не найдено')
    revokeSession(deps, session, 'Завершена с другого устройства')
    audit(deps, c.var.user.id, 'session-revoked', userAgent(c), session.userAgent)
    return c.json({ ok: true })
  })

  app.post('/sessions/revoke-others', (c) => {
    revokeAllSessions(deps, c.var.user.id, 'Завершены все другие устройства', c.var.session.id)
    audit(deps, c.var.user.id, 'session-revoked', userAgent(c), 'все, кроме текущего')
    return c.json({ ok: true })
  })

  // ─── Подтверждение личности («режим судо») ─────────────────────────────────

  /**
   * Подтвердить «это я»: паролем, кодом 2FA или ключом доступа. После этого
   * 5 минут можно делать опасные действия.
   */
  app.post('/step-up', async (c) => {
    const body = await parseBody(c, z.object({ password: z.string().optional(), code: totpCodeSchema.optional() }))
    const { user, session } = c.var
    stepUpLimit(`step-up:${user.id}`)
    let ok = false
    if (body.password && user.passwordHash) ok = await verifyPassword(body.password, user.passwordHash)
    else if (body.code && user.totp) {
      const counter = await verifyTotp(user.totp.secret, body.code, deps.now(), user.totp.lastCounter)
      if (counter !== null) {
        user.totp.lastCounter = counter
        ok = true
      }
    }
    if (!ok) throw new ApiError(401, 'reauth-failed', 'Не подошло', { [body.password ? 'password' : 'code']: 'Не подошло — попробуйте ещё раз' })
    session.stepUpAt = deps.now()
    deps.db.changed()
    return c.json({ ok: true, until: session.stepUpAt + CONFIG.stepUpTtlSec * 1000 })
  })

  app.post('/step-up/passkey/options', async (c) => c.json(await authenticationOptions(deps)))

  app.post('/step-up/passkey', async (c) => {
    const body = await parseBody(c, z.object({ challengeId: z.string(), response: z.any() }))
    const passkey = await verifyAuthentication(deps, body.challengeId, body.response)
    if (passkey.userId !== c.var.user.id) throw new ApiError(401, 'reauth-failed', 'Это ключ другого пользователя')
    c.var.session.stepUpAt = deps.now()
    deps.db.changed()
    return c.json({ ok: true })
  })

  // ─── Пароль ─────────────────────────────────────────────────────────────────

  app.post('/password', async (c) => {
    requireRecentAuth(c)
    const { password } = await parseBody(c, z.object({ password: passwordSchema }))
    const { user, session } = c.var
    const firstPassword = user.passwordHash === null
    user.passwordHash = await hashPassword(password, iterations)
    // Остальные устройства выходят: если пароль меняют из-за утечки, вор вылетит.
    revokeAllSessions(deps, user.id, 'Пароль изменён', session.id)
    deps.db.changed()
    audit(deps, user.id, 'password-changed', userAgent(c), firstPassword ? 'задан впервые' : '')
    sendMail(deps, user.email, 'Пароль изменён', 'Пароль от Пропуска изменён. Если это не вы — восстановите доступ по ссылке.', `${deps.appUrl}/forgot-password`)
    return c.json(publicUser(deps, user))
  })

  // ─── Двухфакторная защита (TOTP) ────────────────────────────────────────────

  /** Шаг 1: придумать секрет и показать QR. Пока код не подтверждён, 2FA выключена. */
  app.post('/totp/setup', (c) => {
    requireRecentAuth(c)
    const { user } = c.var
    if (user.totp) throw new ApiError(409, 'totp-enabled', 'Двухфакторная защита уже включена')
    user.pendingTotpSecret = generateTotpSecret()
    deps.db.changed()
    return c.json({ secret: user.pendingTotpSecret, otpauthUrl: otpauthUrl(user.pendingTotpSecret, user.email, CONFIG.rpName) })
  })

  /**
   * Шаг 2: человек ввёл код из приложения — значит, секрет сохранился
   * правильно. Включаем и выдаём коды восстановления (показываем один раз).
   */
  app.post('/totp/enable', async (c) => {
    const { code } = await parseBody(c, z.object({ code: totpCodeSchema }))
    const { user } = c.var
    if (!user.pendingTotpSecret) throw new ApiError(400, 'totp-no-setup', 'Сначала отсканируйте QR-код')
    const counter = await verifyTotp(user.pendingTotpSecret, code, deps.now())
    if (counter === null) throw new ApiError(400, 'invalid', 'Код не подошёл', { code: 'Код не подошёл — проверьте время на телефоне' })
    user.totp = { secret: user.pendingTotpSecret, enabledAt: deps.now(), lastCounter: counter }
    user.pendingTotpSecret = null
    const codes = generateRecoveryCodes()
    user.recoveryCodes = await Promise.all(codes.map(sha256))
    deps.db.changed()
    audit(deps, user.id, 'totp-enabled', userAgent(c))
    sendMail(deps, user.email, 'Включена двухфакторная защита', 'Теперь при входе понадобится код из приложения.', `${deps.appUrl}/security`)
    return c.json({ recoveryCodes: codes, user: publicUser(deps, user) })
  })

  app.post('/totp/disable', (c) => {
    requireRecentAuth(c)
    const { user } = c.var
    user.totp = null
    user.recoveryCodes = []
    deps.db.changed()
    audit(deps, user.id, 'totp-disabled', userAgent(c))
    sendMail(deps, user.email, 'Двухфакторная защита выключена', 'Если это не вы — срочно смените пароль.', `${deps.appUrl}/security`)
    return c.json(publicUser(deps, user))
  })

  app.post('/recovery-codes', async (c) => {
    requireRecentAuth(c)
    const { user } = c.var
    if (!user.totp) throw new ApiError(400, 'totp-disabled', 'Сначала включите двухфакторную защиту')
    const codes = generateRecoveryCodes()
    user.recoveryCodes = await Promise.all(codes.map(sha256))
    deps.db.changed()
    return c.json({ recoveryCodes: codes })
  })

  // ─── Ключи доступа (passkeys) ───────────────────────────────────────────────

  app.get('/passkeys', (c) =>
    c.json(
      deps.db.data.passkeys
        .filter((p) => p.userId === c.var.user.id)
        .map(({ id, name, createdAt, lastUsedAt, transports }) => ({ id, name, createdAt, lastUsedAt, transports })),
    ),
  )

  app.post('/passkeys/options', async (c) => {
    requireRecentAuth(c)
    return c.json(await registrationOptions(deps, c.var.user))
  })

  app.post('/passkeys', async (c) => {
    const body = await parseBody(c, z.object({ challengeId: z.string(), response: z.any(), name: z.string().trim().max(40).default('') }))
    const passkey = await verifyRegistration(deps, c.var.user, body.challengeId, body.response, body.name)
    audit(deps, c.var.user.id, 'passkey-added', userAgent(c), passkey.name)
    sendMail(deps, c.var.user.email, 'Добавлен ключ доступа', `Новый ключ: «${passkey.name}». Если это не вы — удалите его в настройках.`, `${deps.appUrl}/security`)
    return c.json({ id: passkey.id, name: passkey.name }, 201)
  })

  app.delete('/passkeys/:id', (c) => {
    requireRecentAuth(c)
    const list = deps.db.data.passkeys
    const index = list.findIndex((p) => p.id === c.req.param('id') && p.userId === c.var.user.id)
    if (index < 0) throw new ApiError(404, 'not-found', 'Ключ не найден')
    const [removed] = list.splice(index, 1)
    deps.db.changed()
    audit(deps, c.var.user.id, 'passkey-removed', userAgent(c), removed!.name)
    return c.json({ ok: true })
  })

  // ─── Журнал ─────────────────────────────────────────────────────────────────

  app.get('/activity', (c) => c.json(deps.db.data.audit.filter((e) => e.userId === c.var.user.id).slice(0, 100)))

  return app
}
