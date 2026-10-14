/**
 * «Ромашка ID» — демо-провайдер входа (как «Войти через …» на других сайтах).
 * В жизни это ЧУЖОЙ сервер на другом домене; здесь он живёт рядом, под
 * /provider, чтобы демо работало без интернета. Протокол — настоящий:
 * OAuth 2.0 Authorization Code + PKCE и OpenID Connect (id_token).
 *
 *   1. Наш сайт отправляет человека на страницу провайдера с параметрами:
 *      client_id, redirect_uri, state, nonce, code_challenge.
 *   2. Человек входит у провайдера и соглашается «дать Пропуску имя и почту».
 *   3. Провайдер возвращает его на redirect_uri с одноразовым code.
 *   4. НАШ СЕРВЕР обменивает code на токены (POST /token) — с code_verifier и
 *      секретом клиента. Браузер в этом обмене не участвует.
 *   5. id_token — JWT, подписанный закрытым ключом провайдера. Мы проверяем
 *      подпись его открытым ключом (JWKS) — так узнаём, что данные не подделаны.
 */
import { Hono } from 'hono'
import { SignJWT, exportJWK, generateKeyPair, importJWK } from 'jose'
import { z } from 'zod'

import type { AppEnv, Deps } from '../context.ts'
import { randomToken, safeEqual, sha256 } from '../lib/crypto.ts'
import { ApiError, parseBody } from '../lib/http.ts'

export const PROVIDER_ISSUER = 'https://id.romashka.example'
export const CLIENT_ID = 'propusk'
/** Секрет клиента — знают только наш сервер и провайдер. В браузер не попадает. */
export const CLIENT_SECRET = 'propusk-demo-client-secret'

/** Зарегистрированные приложения: куда провайдер имеет право вернуть человека. */
function clients(deps: Deps): Record<string, { name: string; redirectUris: string[] } | undefined> {
  return { [CLIENT_ID]: { name: 'Пропуск', redirectUris: [`${deps.appUrl}/auth/romashka`] } }
}

export async function ensureProviderKeys(deps: Deps) {
  const provider = deps.db.data.provider
  if (provider.privateJwk && provider.publicJwk) return
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  provider.privateJwk = await exportJWK(privateKey)
  provider.publicJwk = { ...(await exportJWK(publicKey)), kid: 'romashka-1', alg: 'ES256', use: 'sig' } as JsonWebKey
  deps.db.changed()
}

/** PKCE: code_challenge = base64url(SHA-256(code_verifier)). */
const s256 = (verifier: string) => sha256(verifier)

export function providerRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()

  /** Какие аккаунты «вошли» в Ромашку на этом устройстве — для экрана выбора аккаунта. */
  app.get('/api/accounts', (c) => c.json(deps.db.data.provider.users))

  app.get('/api/client/:id', (c) => {
    const client = clients(deps)[c.req.param('id')]
    if (!client) throw new ApiError(404, 'unknown-client', 'Неизвестное приложение')
    return c.json({ name: client.name })
  })

  /** Человек нажал «Разрешить» на странице провайдера. */
  app.post('/api/authorize', async (c) => {
    const body = await parseBody(
      c,
      z.object({
        accountId: z.string(),
        client_id: z.string(),
        redirect_uri: z.string(),
        code_challenge: z.string().min(43),
        code_challenge_method: z.literal('S256'),
        nonce: z.string().min(16),
        state: z.string().min(16),
      }),
    )
    const client = clients(deps)[body.client_id]
    // redirect_uri сверяется ТОЧНО со списком: иначе код утёк бы на сайт злоумышленника.
    if (!client || !client.redirectUris.includes(body.redirect_uri)) {
      throw new ApiError(400, 'invalid-redirect', 'Адрес возврата не зарегистрирован для этого приложения')
    }
    const account = deps.db.data.provider.users.find((u) => u.id === body.accountId)
    if (!account) throw new ApiError(400, 'unknown-account', 'Аккаунт не найден')
    const code = randomToken()
    deps.db.data.provider.codes.push({
      hash: await sha256(code),
      providerUserId: account.id,
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
      nonce: body.nonce,
      expiresAt: deps.now() + 60_000, // код живёт минуту
    })
    deps.db.changed()
    const url = new URL(body.redirect_uri)
    url.searchParams.set('code', code)
    url.searchParams.set('state', body.state) // state возвращаем как есть — клиент сверит его
    return c.json({ redirectTo: url.toString() })
  })

  /**
   * Обмен кода на токены. Сюда ходит СЕРВЕР Пропуска, не браузер.
   * Формат запроса по стандарту — форма (application/x-www-form-urlencoded).
   */
  app.post('/token', async (c) => {
    const form = await c.req.parseBody()
    const get = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '')
    if (get('grant_type') !== 'authorization_code') throw new ApiError(400, 'unsupported_grant_type', 'Только authorization_code')
    if (get('client_id') !== CLIENT_ID || !safeEqual(get('client_secret'), CLIENT_SECRET)) {
      throw new ApiError(401, 'invalid_client', 'Неверный клиент')
    }
    const hash = await sha256(get('code'))
    const codes = deps.db.data.provider.codes
    const record = codes.find((r) => r.hash === hash)
    // Код одноразовый: удаляем сразу, даже если дальше что-то не сойдётся.
    deps.db.data.provider.codes = codes.filter((r) => r !== record)
    deps.db.changed()
    if (!record || record.expiresAt < deps.now() || record.redirectUri !== get('redirect_uri') || record.clientId !== get('client_id')) {
      throw new ApiError(400, 'invalid_grant', 'Код недействителен')
    }
    // PKCE: доказать, что меняет код тот же, кто начинал вход.
    if ((await s256(get('code_verifier'))) !== record.codeChallenge) {
      throw new ApiError(400, 'invalid_grant', 'code_verifier не совпал с code_challenge')
    }
    const account = deps.db.data.provider.users.find((u) => u.id === record.providerUserId)!
    const key = await importJWK(deps.db.data.provider.privateJwk!, 'ES256')
    const now = Math.floor(deps.now() / 1000)
    const idToken = await new SignJWT({ email: account.email, email_verified: true, name: account.name, nonce: record.nonce })
      .setProtectedHeader({ alg: 'ES256', kid: 'romashka-1' })
      .setIssuer(PROVIDER_ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject(account.id)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(key)
    return c.json({ access_token: randomToken(), token_type: 'Bearer', expires_in: 300, id_token: idToken })
  })

  /** Открытые ключи провайдера: по ним кто угодно проверит подпись id_token. */
  app.get('/.well-known/jwks.json', (c) => c.json({ keys: [deps.db.data.provider.publicJwk] }))

  return app
}
