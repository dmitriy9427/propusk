/**
 * «Подтвердите, что это вы» — окно, которое появляется само, когда сервер
 * ответил 403 reauth-required (см. server/core.ts → requireRecentAuth).
 *
 * Как это устроено: http.ts ловит такой ответ и вызывает requestStepUp().
 * Та возвращает Promise и показывает окно (StepUpDialog подписан на это
 * хранилище). Человек ввёл пароль → Promise выполнился → http.ts повторил
 * исходный запрос. Нажал «Отмена» → Promise отклонён → запрос завершился ошибкой.
 *
 * Код страницы ничего этого не знает: он просто вызвал api('/me/password').
 */
import { useSyncExternalStore } from 'react'

interface Pending {
  resolve: () => void
  reject: (error: Error) => void
}

let pending: Pending | null = null
let waiters: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function requestStepUp(): Promise<void> {
  // Два запроса одновременно упёрлись в судо — окно одно, ждут оба.
  waiters ??= new Promise<void>((resolve, reject) => {
    pending = { resolve, reject }
    emit()
  }).finally(() => {
    pending = null
    waiters = null
    emit()
  })
  return waiters
}

export const confirmStepUp = () => pending?.resolve()
export const cancelStepUp = () => pending?.reject(new Error('Подтверждение отменено'))

export function useStepUpOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pending !== null,
  )
}
