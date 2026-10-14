/**
 * Passkeys в браузере. Разговор с устройством (Touch ID, Windows Hello, ключ)
 * берёт на себя @simplewebauthn/browser — он переводит JSON от сервера в
 * формат navigator.credentials.create/get и обратно.
 */
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser'

import { api } from './http'

export const passkeysSupported = () => browserSupportsWebAuthn()

/** Перевести ошибку браузера в понятный текст. */
export function passkeyError(error: unknown) {
  const name = (error as Error)?.name
  if (name === 'NotAllowedError') return 'Отменено или время вышло'
  if (name === 'InvalidStateError') return 'Этот ключ уже добавлен'
  if (name === 'SecurityError') return 'Ключи доступа работают только на защищённом адресе (https или localhost)'
  return (error as Error)?.message ?? 'Не получилось'
}

/** Вход по ключу: сервер даёт вызов → устройство подписывает → сервер проверяет. */
export async function signInWithPasskey<T>() {
  const { options, challengeId } = await api<{ options: never; challengeId: string }>('/auth/passkey/options', { method: 'POST', noRefresh: true })
  const response = await startAuthentication({ optionsJSON: options })
  return api<T>('/auth/passkey/verify', { method: 'POST', body: { challengeId, response }, noRefresh: true })
}

export async function registerPasskey(name: string) {
  const { options, challengeId } = await api<{ options: never; challengeId: string }>('/me/passkeys/options', { method: 'POST' })
  const response = await startRegistration({ optionsJSON: options })
  return api('/me/passkeys', { method: 'POST', body: { challengeId, response, name } })
}

export async function stepUpWithPasskey() {
  const { options, challengeId } = await api<{ options: never; challengeId: string }>('/me/step-up/passkey/options', { method: 'POST' })
  const response = await startAuthentication({ optionsJSON: options })
  return api('/me/step-up/passkey', { method: 'POST', body: { challengeId, response } })
}
