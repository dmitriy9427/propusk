/**
 * Ядро авторизации: сессии, токены, письма, журнал. Маршруты (routes/*)
 * только разбирают запрос и вызывают функции отсюда.
 */
import type { Context, MiddlewareHandler } from 'hono'

import { CONFIG } from './config.ts'
import type { AppEnv, Deps } from './context.ts'
import type { AuditType, EmailPurpose, Session, User } from './db.ts'
import { clearRefreshCookie, readCookie, writeRefreshCookie } from './lib/cookies.ts'
import { randomId, randomToken, sha256 } from './lib/crypto.ts'
import { ApiError, forbidden, unauthorized } from './lib/http.ts'
import { signAccessToken, verifyAccessToken } from './lib/jwt.ts'

type Ctx = Context<AppEnv>

export const userAgent = (c: Ctx) => c.req.header('user-agent') ?? 'неизвестное устройство'

// ─── Как пользователь выглядит снаружи ────────────────────────────────────────

/** Пользователь для клиента: без хешей, секретов и счётчиков. */
export function publicUser(deps: Deps, user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    hasPassword: user.passwordHash !== null,
    totpEnabled: user.totp !== null,
    recoveryCodesLeft: user.recoveryCodes.length,
    passkeys: deps.db.data.passkeys.filter((p) => p.userId === user.id).length,
    identities: user.identities.map((i) => i.provider),
    createdAt: user.createdAt,
  }
}

export type PublicUser = ReturnType<typeof publicUser>

// ─── Журнал и почта ───────────────────────────────────────────────────────────

export function audit(deps: Deps, userId: string, type: AuditType, ua: string, details = '') {
  deps.db.data.audit.unshift({ id: randomId(), userId, type, at: deps.now(), userAgent: ua, details })
  deps.db.data.audit.length = Math.min(deps.db.data.audit.length, 2000)
  deps.db.changed()
}

export function sendMail(deps: Deps, to: string, subject: string, text: string, link = '') {
  deps.db.data.mails.unshift({ id: randomId(), to, subject, text, link, createdAt: deps.now() })
  deps.db.data.mails.length = Math.min(deps.db.data.mails.length, 200)
  deps.db.changed()
}

/**
 * Одноразовая ссылка из письма. В письмо уходит сам токен, в базу — его хеш:
 * даже с доступом к базе ссылкой не воспользоваться.
 */
export async function issueEmailToken(deps: Deps, userId: string, purpose: EmailPurpose, ttlSec: number) {
  const token = randomToken()
  const { emailTokens } = deps.db.data
  // Новая ссылка отменяет старые того же назначения: работает только последняя.
  for (const t of emailTokens) if (t.userId === userId && t.purpose === purpose && !t.usedAt) t.usedAt = deps.now()
  emailTokens.push({ hash: await sha256(token), purpose, userId, expiresAt: deps.now() + ttlSec * 1000, usedAt: null })
  deps.db.changed()
  return token
}

export async function consumeEmailToken(deps: Deps, token: string, purpose: EmailPurpose): Promise<User> {
  const hash = await sha256(token)
  const record = deps.db.data.emailTokens.find((t) => t.hash === hash && t.purpose === purpose)
  // Одно сообщение на все случаи: не подсказываем, существовала ли ссылка.
  const invalid = new ApiError(400, 'link-invalid', 'Ссылка недействительна или устарела — запросите новую')
  if (!record || record.usedAt || record.expiresAt < deps.now()) throw invalid
  const user = deps.db.data.users.find((u) => u.id === record.userId)
  if (!user) throw invalid
  record.usedAt = deps.now() // одноразовая
  deps.db.changed()
  return user
}

export const link = (deps: Deps, path: string, token: string) => `${deps.appUrl}${path}?token=${encodeURIComponent(token)}`

// ─── Сессии и токены ─────────────────────────────────────────────────────────

/**
 * Вход состоялся: создать сессию (устройство), выдать пару токенов.
 *   access-токен — в ответе (клиент держит его в памяти);
 *   refresh-токен — в HttpOnly-cookie (JavaScript его не видит).
 */
export async function startSession(c: Ctx, user: User, method: Session['method']) {
  const deps = c.var.deps
  const now = deps.now()
  const refresh = randomToken()
  const session: Session = {
    id: randomId(),
    userId: user.id,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + CONFIG.refreshTtlSec * 1000,
    userAgent: userAgent(c),
    tokenHash: await sha256(refresh),
    usedHashes: [],
    method,
    // Только что ввёл пароль — значит, «судо» уже есть на 5 минут.
    stepUpAt: now,
    revokedAt: null,
    revokeReason: null,
  }
  deps.db.data.sessions.push(session)
  user.failedLogins = 0
  user.lockedUntil = 0
  deps.db.changed()
  audit(deps, user.id, 'login', session.userAgent, methodLabel(method))
  writeRefreshCookie(c, refresh)
  return tokenResponse(deps, user, session)
}

async function tokenResponse(deps: Deps, user: User, session: Session) {
  const accessToken = await signAccessToken(
    deps.db.data.jwtSecret,
    { sub: user.id, sid: session.id, role: user.role, method: session.method },
    deps.now(),
  )
  return { accessToken, expiresIn: CONFIG.accessTtlSec, user: publicUser(deps, user) }
}

export function revokeSession(deps: Deps, session: Session, reason: string) {
  if (session.revokedAt) return
  session.revokedAt = deps.now()
  session.revokeReason = reason
  deps.db.changed()
}

export function revokeAllSessions(deps: Deps, userId: string, reason: string, except?: string) {
  for (const s of deps.db.data.sessions) if (s.userId === userId && s.id !== except) revokeSession(deps, s, reason)
}

/**
 * Обновление токенов с РОТАЦИЕЙ и обнаружением повторного использования.
 *
 *   1. Пришёл refresh-токен → ищем сессию по его хешу.
 *   2. Нашли как действующий → выдаём НОВЫЙ refresh, старый помечаем использованным.
 *   3. Нашли среди использованных → его кто-то сохранил и предъявил второй раз:
 *      либо вор, либо мы. Кто из двоих настоящий — неизвестно, поэтому
 *      отзываем всю сессию: обоим придётся войти заново.
 */
export async function rotateRefresh(c: Ctx) {
  const deps = c.var.deps
  const token = readCookie(c, CONFIG.refreshCookie)
  if (!token) throw unauthorized('no-session', 'Сессия не найдена')
  const hash = await sha256(token)
  const sessions = deps.db.data.sessions

  const reused = sessions.find((s) => s.usedHashes.includes(hash))
  if (reused) {
    revokeSession(deps, reused, 'Повторно использован старый refresh-токен — возможна кража')
    audit(deps, reused.userId, 'refresh-reuse', userAgent(c), 'сессия завершена')
    clearRefreshCookie(c)
    throw unauthorized('refresh-reused', 'Сессия завершена из соображений безопасности')
  }

  const session = sessions.find((s) => s.tokenHash === hash)
  const user = session && deps.db.data.users.find((u) => u.id === session.userId)
  if (!session || !user || session.revokedAt || session.expiresAt < deps.now() || user.blocked) {
    clearRefreshCookie(c)
    throw unauthorized('session-ended', 'Сессия закончилась — войдите снова')
  }

  const next = randomToken()
  session.usedHashes.push(session.tokenHash)
  session.usedHashes = session.usedHashes.slice(-50)
  session.tokenHash = await sha256(next)
  session.lastUsedAt = deps.now()
  deps.db.changed()
  writeRefreshCookie(c, next)
  return tokenResponse(deps, user, session)
}

export async function endSessionByCookie(c: Ctx) {
  const deps = c.var.deps
  const token = readCookie(c, CONFIG.refreshCookie)
  clearRefreshCookie(c)
  if (!token) return
  const hash = await sha256(token)
  const session = deps.db.data.sessions.find((s) => s.tokenHash === hash)
  if (session) {
    revokeSession(deps, session, 'Выход')
    audit(deps, session.userId, 'logout', userAgent(c))
  }
}

// ─── Проверки на маршрутах ────────────────────────────────────────────────────

/**
 * Только для вошедших. Проверяем не только подпись JWT, но и сессию в базе:
 * JWT нельзя «отозвать», а сессию — можно. Завершили сессию на другом
 * устройстве — её access-токен перестаёт работать сразу, а не через 10 минут.
 * Цена — один поиск в базе на запрос; для входа и профиля это нормально.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const deps = c.var.deps
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw unauthorized()
  let claims
  try {
    claims = await verifyAccessToken(deps.db.data.jwtSecret, token, deps.now())
  } catch {
    // Клиент по этому коду поймёт: надо обновить токен и повторить запрос.
    throw unauthorized('token-expired', 'Токен устарел')
  }
  const session = deps.db.data.sessions.find((s) => s.id === claims.sid)
  const user = deps.db.data.users.find((u) => u.id === claims.sub)
  if (!session || session.revokedAt || !user) throw unauthorized('session-ended', 'Сессия завершена')
  if (user.blocked) throw forbidden('blocked', 'Учётная запись заблокирована')
  c.set('user', user)
  c.set('session', session)
  await next()
}

/** Права по ролям: requireRole('admin'). Роль берём из базы, а не из токена — её могли поменять. */
export const requireRole =
  (role: User['role']): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (c.var.user.role !== role) throw forbidden()
    await next()
  }

/**
 * «Режим судо»: опасные действия (сменить пароль, выключить 2FA, удалить
 * passkey, заблокировать пользователя) — только если личность подтверждали
 * за последние 5 минут. Иначе 403 с кодом reauth-required: клиент покажет окно
 * «Подтвердите, что это вы» и повторит запрос.
 *
 * Зачем: если кто-то сел за ваш незаблокированный ноутбук, он не сможет
 * отключить защиту и сменить пароль, не зная пароля.
 */
export function requireRecentAuth(c: Ctx) {
  const { session } = c.var
  if (c.var.deps.now() - session.stepUpAt > CONFIG.stepUpTtlSec * 1000) {
    throw forbidden('reauth-required', 'Подтвердите, что это вы')
  }
}

export function methodLabel(method: Session['method']) {
  return {
    password: 'пароль',
    'password+totp': 'пароль и код 2FA',
    'magic-link': 'ссылка из письма',
    passkey: 'ключ доступа',
    romashka: 'Ромашка ID',
  }[method]
}
