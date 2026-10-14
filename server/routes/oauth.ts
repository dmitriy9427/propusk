/**
 * Вход через «Ромашка ID» — наша сторона (шаги 4–5 из provider/provider.ts).
 * Браузер присылает code и code_verifier, а сервер:
 *   1. меняет code на токены у провайдера (с секретом клиента);
 *   2. проверяет подпись id_token открытым ключом провайдера, срок, издателя,
 *      получателя и nonce;
 *   3. находит или создаёт пользователя и начинает сессию.
 */
import type { Hono as HonoType } from 'hono'
import { Hono } from 'hono'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'

import type { AppEnv, Deps } from '../context.ts'
import { audit, startSession, userAgent } from '../core.ts'
import type { User } from '../db.ts'
import { randomId } from '../lib/crypto.ts'
import { ApiError, parseBody } from '../lib/http.ts'
import { CLIENT_ID, CLIENT_SECRET, PROVIDER_ISSUER } from '../provider/provider.ts'
import { mfaTicket } from './auth.ts'

/**
 * provider — «сеть до провайдера». В жизни это fetch('https://id.romashka.example/token').
 * Здесь провайдер живёт в том же процессе, но мы всё равно ходим к нему HTTP-запросом
 * (provider.request), чтобы код выглядел так же, как с настоящим провайдером.
 */
export function oauthRoutes(deps: Deps, provider: HonoType<AppEnv>) {
  const app = new Hono<AppEnv>()

  app.post('/romashka', async (c) => {
    const body = await parseBody(c, z.object({ code: z.string().min(1), codeVerifier: z.string().min(43), nonce: z.string().min(16) }))
    const redirectUri = `${deps.appUrl}/auth/romashka`

    // 1. Обмен кода на токены.
    const tokenResponse = await provider.request(
      '/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: body.code,
          redirect_uri: redirectUri,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code_verifier: body.codeVerifier,
        }).toString(),
      },
    )
    if (!tokenResponse.ok) throw new ApiError(400, 'oauth-failed', 'Ромашка ID не подтвердила вход — начните заново')
    const { id_token: idToken } = (await tokenResponse.json()) as { id_token: string }

    // 2. Проверка id_token: подпись (ключом из JWKS), iss, aud, срок — и nonce.
    const jwks = (await (await provider.request('/.well-known/jwks.json')).json()) as { keys: JsonWebKey[] }
    const { payload } = await jwtVerify(idToken, createLocalJWKSet(jwks as never), {
      issuer: PROVIDER_ISSUER,
      audience: CLIENT_ID,
      algorithms: ['ES256'],
      currentDate: new Date(deps.now()),
    }).catch(() => {
      throw new ApiError(400, 'oauth-failed', 'Подпись id_token не прошла проверку')
    })
    // nonce связывает id_token с ЭТОЙ попыткой входа: старый перехваченный токен не подсунуть.
    if (payload.nonce !== body.nonce) throw new ApiError(400, 'oauth-failed', 'nonce не совпал')
    const subject = String(payload.sub)
    const email = String(payload.email).toLowerCase()
    const name = String(payload.name ?? email)

    // 3. Кто это у нас?
    const users = deps.db.data.users
    let user = users.find((u) => u.identities.some((i) => i.provider === 'romashka' && i.subject === subject))
    if (!user) {
      // Есть аккаунт с такой почтой — привязываем. Безопасно, только если почта
      // подтверждена И у нас, И у провайдера (email_verified): иначе чужой
      // человек завёл бы в Ромашке аккаунт на вашу почту и вошёл в ваш Пропуск.
      const byEmail = users.find((u) => u.email === email)
      if (byEmail && byEmail.emailVerified && payload.email_verified === true) {
        byEmail.identities.push({ provider: 'romashka', subject })
        user = byEmail
        audit(deps, user.id, 'identity-linked', userAgent(c), 'Ромашка ID')
      } else if (byEmail) {
        throw new ApiError(409, 'email-taken', 'Аккаунт с этой почтой уже есть — войдите паролем и привяжите Ромашку в настройках')
      } else {
        user = newFederatedUser(deps, email, name, subject)
        users.push(user)
        audit(deps, user.id, 'register', userAgent(c), 'через Ромашка ID')
      }
      deps.db.changed()
    }
    if (user.blocked) throw new ApiError(403, 'blocked', 'Учётная запись заблокирована администратором')
    // Включена 2FA — Ромашка подтверждает почту, но не заменяет второй фактор Пропуска.
    if (user.totp) return c.json(await mfaTicket(deps, userAgent(c), user, 'romashka'))
    return c.json(await startSession(c, user, 'romashka'))
  })

  return app
}

function newFederatedUser(deps: Deps, email: string, name: string, subject: string): User {
  return {
    id: randomId(),
    email,
    name,
    emailVerified: true,
    passwordHash: null,
    role: 'user',
    blocked: false,
    createdAt: deps.now(),
    totp: null,
    pendingTotpSecret: null,
    recoveryCodes: [],
    failedLogins: 0,
    lockedUntil: 0,
    identities: [{ provider: 'romashka', subject }],
  }
}
