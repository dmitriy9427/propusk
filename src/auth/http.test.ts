/**
 * Клиентская логика токенов без сервера: fetch подменён на функцию, которая
 * отвечает по сценарию. Проверяем ровно то, что сложно увидеть руками.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, refreshTokens } from './http'
import { getSession, setSession } from './session-store'
import { cancelStepUp, confirmStepUp } from './step-up'

const user = { id: 'u', email: 'a@b.c', name: 'А', role: 'user', emailVerified: true, hasPassword: true, totpEnabled: false, recoveryCodesLeft: 0, passkeys: 0, identities: [], createdAt: 0 }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let calls: string[] = []
function server(handler: (path: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const path = input.replace('/api', '')
    calls.push(`${init.method ?? 'GET'} ${path}`)
    return handler(path, init)
  })
}

beforeEach(() => {
  calls = []
  setSession({ status: 'authenticated', user: user as never, accessToken: 'old', expiresAt: Date.now() + 60_000 })
})
afterEach(() => vi.unstubAllGlobals())

describe('api(): токены', () => {
  it('401 token-expired → одно обновление → повтор запроса с новым токеном', async () => {
    server((path, init) => {
      if (path === '/auth/refresh') return json(200, { accessToken: 'new', expiresIn: 600, user })
      const auth = (init.headers as Record<string, string>).authorization
      return auth === 'Bearer new' ? json(200, { ok: true }) : json(401, { code: 'token-expired' })
    })
    await expect(api('/me')).resolves.toEqual({ ok: true })
    expect(calls).toEqual(['GET /me', 'POST /auth/refresh', 'GET /me'])
  })

  it('пять запросов с устаревшим токеном → обновление ОДНО (single flight)', async () => {
    server(async (path, init) => {
      if (path === '/auth/refresh') {
        await new Promise((r) => setTimeout(r, 20))
        return json(200, { accessToken: 'new', expiresIn: 600, user })
      }
      return (init.headers as Record<string, string>).authorization === 'Bearer new' ? json(200, {}) : json(401, { code: 'token-expired' })
    })
    await Promise.all([1, 2, 3, 4, 5].map(() => api('/me')))
    expect(calls.filter((c) => c === 'POST /auth/refresh')).toHaveLength(1)
  })

  it('refresh отправляется с заголовком X-Propusk (защита от CSRF)', async () => {
    let header: string | undefined
    server((_, init) => {
      header = (init.headers as Record<string, string>)['x-propusk']
      return json(200, { accessToken: 'new', expiresIn: 600, user })
    })
    await refreshTokens()
    expect(header).toBe('1')
  })

  it('refresh не удался → сессия «аноним»; кража токена — с понятной причиной', async () => {
    server(() => json(401, { code: 'refresh-reused', message: 'Сессия завершена из соображений безопасности' }))
    expect(await refreshTokens()).toBe(false)
    expect(getSession()).toEqual({ status: 'anonymous', reason: 'Сессия завершена из соображений безопасности' })
  })
})

describe('api(): режим судо', () => {
  it('403 reauth-required → ждём подтверждения → повторяем запрос', async () => {
    let confirmed = false
    server(() => (confirmed ? json(200, { done: true }) : json(403, { code: 'reauth-required' })))
    const request = api('/me/password', { method: 'POST', body: {} })
    await new Promise((r) => setTimeout(r, 10)) // окно «показано»
    confirmed = true
    confirmStepUp()
    await expect(request).resolves.toEqual({ done: true })
  })

  it('«Отмена» в окне → запрос завершается ошибкой, повтора нет', async () => {
    server(() => json(403, { code: 'reauth-required' }))
    const request = api('/me/totp/disable', { method: 'POST' })
    await new Promise((r) => setTimeout(r, 10))
    cancelStepUp()
    await expect(request).rejects.toThrow('Подтверждение отменено')
    expect(calls).toEqual(['POST /me/totp/disable'])
  })
})
