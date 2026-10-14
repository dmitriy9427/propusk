// @vitest-environment node
/**
 * Вход через «Ромашка ID»: OAuth 2.0 + PKCE + OpenID Connect.
 * Тест играет роль браузера: начинает вход, «соглашается» у провайдера,
 * возвращается с кодом — и проверяет каждую защиту по отдельности.
 */
import { describe, expect, it } from 'vitest'

import { randomToken, sha256 } from './lib/crypto.ts'
import { APP_URL, setup } from './test-utils.ts'

const REDIRECT = `${APP_URL}/auth/romashka`

async function startFlow(t: Awaited<ReturnType<typeof setup>>, accountId: string, overrides: Record<string, string> = {}) {
  const verifier = randomToken(32) // 43 символа base64url
  const params = {
    accountId,
    client_id: 'propusk',
    redirect_uri: REDIRECT,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    nonce: randomToken(16),
    state: randomToken(16),
    ...overrides,
  }
  const res = await t.browser().post('/provider/api/authorize', params)
  const redirect = res.body.redirectTo ? new URL(res.body.redirectTo as string) : null
  return { res, verifier, nonce: params.nonce, state: params.state, code: redirect?.searchParams.get('code') ?? '', returnedState: redirect?.searchParams.get('state') }
}

describe('вход через Ромашка ID', () => {
  it('новый человек: аккаунт создаётся, почта подтверждена, пароля нет', async () => {
    const t = await setup()
    const flow = await startFlow(t, 'rm-ivan')
    expect(flow.returnedState).toBe(flow.state) // провайдер вернул state без изменений
    const b = t.browser()
    const login = await b.post('/api/auth/oauth/romashka', { code: flow.code, codeVerifier: flow.verifier, nonce: flow.nonce })
    expect(login.status).toBe(200)
    expect(login.body.user).toMatchObject({ email: 'ivan@romashka.example', hasPassword: false, emailVerified: true, identities: ['romashka'] })
  })

  it('та же почта, что у существующего аккаунта: аккаунты связываются', async () => {
    const t = await setup()
    const flow = await startFlow(t, 'rm-anna')
    const login = await t.browser().post('/api/auth/oauth/romashka', { code: flow.code, codeVerifier: flow.verifier, nonce: flow.nonce })
    expect(login.body.user).toMatchObject({ id: 'u-anna', identities: ['romashka'] })
  })

  it('PKCE: чужой code_verifier не подходит (перехваченный код бесполезен)', async () => {
    const t = await setup()
    const flow = await startFlow(t, 'rm-ivan')
    const r = await t.browser().post('/api/auth/oauth/romashka', { code: flow.code, codeVerifier: randomToken(32), nonce: flow.nonce })
    expect(r.body.code).toBe('oauth-failed')
  })

  it('код одноразовый', async () => {
    const t = await setup()
    const flow = await startFlow(t, 'rm-ivan')
    const body = { code: flow.code, codeVerifier: flow.verifier, nonce: flow.nonce }
    expect((await t.browser().post('/api/auth/oauth/romashka', body)).status).toBe(200)
    expect((await t.browser().post('/api/auth/oauth/romashka', body)).status).toBe(400)
  })

  it('nonce не совпал — id_token от другой попытки входа не принимается', async () => {
    const t = await setup()
    const flow = await startFlow(t, 'rm-ivan')
    const r = await t.browser().post('/api/auth/oauth/romashka', { code: flow.code, codeVerifier: flow.verifier, nonce: randomToken(16) })
    expect(r.body.message).toMatch(/nonce/)
  })

  it('провайдер не отдаёт код на незарегистрированный адрес', async () => {
    const t = await setup()
    const flow = await startFlow(t, 'rm-ivan', { redirect_uri: 'https://evil.example/steal' })
    expect(flow.res.body.code).toBe('invalid-redirect')
  })

  it('код живёт минуту', async () => {
    const t = await setup()
    const flow = await startFlow(t, 'rm-ivan')
    t.advance(61_000)
    expect((await t.browser().post('/api/auth/oauth/romashka', { code: flow.code, codeVerifier: flow.verifier, nonce: flow.nonce })).status).toBe(400)
  })
})
