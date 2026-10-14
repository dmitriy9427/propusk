/**
 * Cookie с refresh-токеном — через «мост», который работает в двух средах.
 *
 * Node: обычные заголовки Cookie и Set-Cookie — всё как на настоящем сервере.
 *
 * Браузерное демо (MSW): браузер не даёт коду страницы ни читать, ни задавать
 * заголовки Cookie/Set-Cookie у запросов и ответов, созданных из JavaScript
 * (это «запрещённые» заголовки). MSW хранит cookie сам и передаёт их нам
 * отдельно. Поэтому переходник (src/mocks/browser.ts) кладёт входящие cookie в
 * c.env.cookies, а исходящие забирает из c.env.setCookie.
 *
 * Код маршрутов об этом не знает: он вызывает readCookie / writeCookie.
 */
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'

import { CONFIG } from '../config.ts'

export interface CookieBridge {
  cookies?: Record<string, string>
  setCookie?: string[]
}

export function readCookie(c: Context, name: string): string | undefined {
  const bridged = (c.env as CookieBridge | undefined)?.cookies
  return bridged ? bridged[name] : getCookie(c, name)
}

interface CookieOptions {
  maxAgeSec: number
  path: string
}

/**
 * Атрибуты refresh-cookie — каждый закрывает свою атаку:
 *   HttpOnly        — JavaScript страницы её не прочитает (XSS не украдёт токен);
 *   Secure          — только по HTTPS (на http://localhost браузеры делают исключение);
 *   SameSite=Strict — браузер не пошлёт её с чужого сайта (защита от CSRF);
 *   Path=/api/auth  — отправляется только на адреса входа, а не с каждым запросом.
 */
export function writeCookie(c: Context, name: string, value: string, { maxAgeSec, path }: CookieOptions) {
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : ''
  const cookie = `${name}=${value}; Max-Age=${maxAgeSec}; Path=${path}; HttpOnly; SameSite=Strict${secure}`
  c.header('Set-Cookie', cookie, { append: true })
  ;(c.env as CookieBridge | undefined)?.setCookie?.push(cookie)
}

export const writeRefreshCookie = (c: Context, token: string) =>
  writeCookie(c, CONFIG.refreshCookie, token, { maxAgeSec: CONFIG.refreshTtlSec, path: CONFIG.refreshCookiePath })

export const clearRefreshCookie = (c: Context) =>
  writeCookie(c, CONFIG.refreshCookie, '', { maxAgeSec: 0, path: CONFIG.refreshCookiePath })
