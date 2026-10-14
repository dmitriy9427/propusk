/**
 * Где живёт сессия на клиенте.
 *
 * Access-токен — ТОЛЬКО в памяти (в переменной), не в localStorage:
 *   - localStorage читает любой скрипт на странице. Одна XSS-уязвимость
 *     (чужой скрипт через рекламу, зависимость, поле без экранирования) —
 *     и токен уехал к злоумышленнику;
 *   - переменная пропадает при перезагрузке — это не страшно: refresh-токен
 *     лежит в HttpOnly-cookie, и при старте мы просто получаем новый access.
 *
 * Хранилище — простой «наблюдаемый объект»: React подписывается на него через
 * useSyncExternalStore. Redux или контекст тут не нужны.
 */
import { useSyncExternalStore } from 'react'

import type { PublicUser } from '@server/core.ts'

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: string }
  | { status: 'authenticated'; user: PublicUser; accessToken: string; expiresAt: number }

let state: SessionState = { status: 'loading' }
const listeners = new Set<() => void>()

export const getSession = () => state

export function setSession(next: SessionState) {
  state = next
  listeners.forEach((listener) => listener())
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Хук: текущая сессия. Перерисует компонент при входе, выходе, обновлении токена. */
export function useSession() {
  return useSyncExternalStore(subscribe, getSession)
}

/** Пользователь или null — для мест, где важно только «кто вошёл». */
export function useUser() {
  const session = useSession()
  return session.status === 'authenticated' ? session.user : null
}

export function getAccessToken() {
  return state.status === 'authenticated' ? state.accessToken : null
}

/** Обновить данные пользователя (после смены имени, включения 2FA…), не трогая токен. */
export function patchUser(user: PublicUser) {
  if (state.status === 'authenticated') setSession({ ...state, user })
}

/**
 * Для лаборатории «Под капотом»: испортить подпись access-токена, как будто он
 * подделан или устарел. Следующий запрос получит 401, и api() обновит токен сам.
 */
export function corruptAccessToken() {
  if (state.status !== 'authenticated') return
  const [header, payload, signature] = state.accessToken.split('.')
  setSession({ ...state, accessToken: `${header}.${payload}.${signature!.slice(0, -4)}AAAA` })
}
