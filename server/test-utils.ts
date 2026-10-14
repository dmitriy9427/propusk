/**
 * Помощники для тестов сервера: приложение с управляемыми часами и «браузер»,
 * который хранит cookie между запросами (как настоящий).
 */
import { createApp } from './app.ts'
import { type Data, emptyData } from './db.ts'
import { totp } from './lib/totp.ts'
import { DEMO_ADMIN_TOTP, DEMO_PASSWORD } from './seed.ts'

export const APP_URL = 'http://localhost:5174'

export async function setup() {
  let now = Date.UTC(2026, 9, 14, 9, 0)
  const db = { data: emptyData() as Data, changed() {} }
  // 1000 повторов PBKDF2 вместо 600 000 — иначе каждый тест шёл бы секунды.
  const app = await createApp({ db, now: () => now, appUrl: APP_URL, rpID: 'localhost', origin: APP_URL, pbkdf2Iterations: 1000 })
  return {
    app,
    db,
    /** Перевести часы вперёд. */
    advance: (ms: number) => {
      now += ms
    },
    now: () => now,
    browser: () => createBrowser(app),
    lastMail: (to: string) => db.data.mails.find((m) => m.to === to),
    tokenFrom: (link: string) => new URL(link).searchParams.get('token')!,
    adminCode: () => totp(DEMO_ADMIN_TOTP, now),
    password: DEMO_PASSWORD,
  }
}

type App = Awaited<ReturnType<typeof createApp>>

/** Мини-браузер: хранит cookie, подставляет Authorization, умеет JSON. */
export function createBrowser(app: App) {
  const jar = new Map<string, string>()
  let accessToken = ''
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await app.request(`${APP_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'TestBrowser/1.0',
        ...(cookie ? { cookie } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';')
      const [name, value = ''] = pair!.split('=')
      const expired = attrs.some((a) => a.trim().toLowerCase() === 'max-age=0')
      if (expired || !value) jar.delete(name!.trim())
      else jar.set(name!.trim(), value)
    }
    const json = (await res.json().catch(() => null)) as Record<string, any> | null
    if (json?.accessToken) accessToken = json.accessToken as string
    return { status: res.status, body: json ?? {} }
  }
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => call('POST', path, body ?? {}, headers),
    patch: (path: string, body?: unknown) => call('PATCH', path, body),
    del: (path: string) => call('DELETE', path),
    refresh: () => call('POST', '/api/auth/refresh', {}, { 'x-propusk': '1' }),
    cookie: (name: string) => jar.get(name),
    setCookie: (name: string, value: string) => jar.set(name, value),
    get token() {
      return accessToken
    },
    set token(value: string) {
      accessToken = value
    },
  }
}
