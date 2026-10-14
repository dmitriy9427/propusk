/**
 * api() — fetch для всего приложения. Делает три вещи сама:
 *
 *   1. Подставляет access-токен: Authorization: Bearer <токен>.
 *   2. Токен устарел (401 token-expired) → обновляет его ОДИН раз и повторяет
 *      запрос. Если в этот момент упали пять запросов сразу, обновление всё
 *      равно одно: остальные ждут тот же Promise («single flight»).
 *   3. Сервер просит подтвердить личность (403 reauth-required) → показывает
 *      окно, ждёт и повторяет запрос.
 *
 * Компоненты просто вызывают api('/me') и ничего не знают про токены.
 */
import { API } from './config'
import { ApiError, toApiError } from './errors'
import { getAccessToken, getSession, setSession } from './session-store'
import { requestStepUp } from './step-up'
import { broadcast, withTabLock } from './tabs'

import type { PublicUser } from '@server/core.ts'

export interface TokenResponse {
  accessToken: string
  expiresIn: number
  user: PublicUser
}

/** Сохранить выданные сервером токены в памяти. */
export function acceptTokens(tokens: TokenResponse) {
  setSession({
    status: 'authenticated',
    user: tokens.user,
    accessToken: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  })
}

// ─── Журнал запросов (для страницы «Под капотом») ─────────────────────────────

export type ApiEvent =
  | { kind: 'request'; method: string; path: string }
  | { kind: 'response'; method: string; path: string; status: number; code?: string }
  | { kind: 'refresh'; ok: boolean; code?: string }
  | { kind: 'retry'; path: string; why: string }

const apiListeners = new Set<(event: ApiEvent) => void>()
export function onApiEvent(listener: (event: ApiEvent) => void) {
  apiListeners.add(listener)
  return () => {
    apiListeners.delete(listener)
  }
}
const emit = (event: ApiEvent) => apiListeners.forEach((l) => l(event))

let refreshing: Promise<boolean> | null = null

/**
 * Обновить access-токен по refresh-cookie. true — получилось, false — сессии нет.
 *
 * Два уровня защиты от «двух обновлений сразу»:
 *   - внутри вкладки: общий Promise `refreshing` (single flight);
 *   - между вкладками: замок withTabLock (см. tabs.ts).
 */
export function refreshTokens(): Promise<boolean> {
  refreshing ??= withTabLock('propusk-refresh', async () => {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      // X-Propusk — защита от CSRF: чужой сайт не может добавить этот заголовок.
      headers: { 'x-propusk': '1' },
      credentials: 'same-origin',
    })
    if (res.ok) {
      acceptTokens((await res.json()) as TokenResponse)
      emit({ kind: 'refresh', ok: true })
      return true
    }
    const error = await toApiError(res)
    emit({ kind: 'refresh', ok: false, code: error.code })
    setSession({ status: 'anonymous', reason: error.code === 'refresh-reused' ? error.message : undefined })
    return false
  }).finally(() => {
    refreshing = null
  })
  return refreshing
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** Не пытаться обновить токен (для самих запросов входа). */
  noRefresh?: boolean
}

export async function api<T = unknown>(path: string, { body, noRefresh, headers, ...init }: ApiOptions = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const send = async () => {
    const token = getAccessToken()
    emit({ kind: 'request', method, path })
    const response = await fetch(`${API}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const code = response.ok ? undefined : ((await response.clone().json().catch(() => ({}))) as { code?: string }).code
    emit({ kind: 'response', method, path, status: response.status, code })
    return response
  }

  let res = await send()

  // ② Токен устарел: обновить и повторить ОДИН раз.
  if (res.status === 401 && !noRefresh) {
    const error = await toApiError(res.clone())
    if (error.code === 'token-expired' && (await refreshTokens())) {
      emit({ kind: 'retry', path, why: 'токен обновлён' })
      res = await send()
    }
    else if (error.code === 'session-ended' && getSession().status === 'authenticated') {
      // Сессию завершили с другого устройства — честно показываем вход.
      setSession({ status: 'anonymous', reason: 'Сессия завершена на другом устройстве' })
    }
  }

  // ③ Нужен «режим судо»: окно → повтор.
  if (res.status === 403) {
    const error = await toApiError(res.clone())
    if (error.code === 'reauth-required') {
      await requestStepUp() // отмена → исключение уйдёт вызывающему
      emit({ kind: 'retry', path, why: 'личность подтверждена' })
      res = await send()
    }
  }

  if (!res.ok) throw await toApiError(res)
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** Выйти: сервер отзовёт сессию и сотрёт cookie; другие вкладки узнают через канал. */
export async function logout(reason?: string) {
  // keepalive — браузер доведёт запрос до сервера, даже если сразу после «Выйти»
  // закрыть вкладку или уйти на другую страницу. Без него запрос мог оборваться,
  // сессия осталась бы живой, и следующий заход восстановил бы её по cookie.
  await fetch(`${API}/auth/logout`, { method: 'POST', headers: { 'x-propusk': '1' }, credentials: 'same-origin', keepalive: true }).catch(() => {})
  setSession({ status: 'anonymous', reason })
  broadcast({ type: 'logout' })
}

export { ApiError }
