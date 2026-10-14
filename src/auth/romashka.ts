/**
 * Вход через «Ромашка ID» — клиентская половина (OAuth 2.0 + PKCE).
 *
 * Перед уходом к провайдеру браузер придумывает три случайные строки:
 *   state         — против CSRF: вернувшись, сверим, что это наш вход, а не
 *                   ссылка, которую злоумышленник подсунул с ЕГО кодом;
 *   code_verifier — PKCE: провайдеру отдаём только его хеш (code_challenge),
 *                   а сам verifier — нашему серверу при обмене кода. Перехватил
 *                   кто-то код из адреса — без verifier обменять его нельзя;
 *   nonce         — попадёт внутрь id_token: сервер проверит, что токен выдан
 *                   именно на эту попытку входа.
 * Хранятся в sessionStorage: живут, пока открыта вкладка, и видны после
 * возврата с провайдера.
 */
import { BASE } from './config'

const KEY = 'propusk:oauth'

function random(bytes = 32) {
  const array = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function s256(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const REDIRECT_URI = () => `${location.origin}${BASE}/auth/romashka`

/** Собрать адрес страницы провайдера и запомнить секреты попытки. */
export async function startRomashkaLogin(next = '/') {
  const state = random(16)
  const nonce = random(16)
  const verifier = random(32)
  sessionStorage.setItem(KEY, JSON.stringify({ state, nonce, verifier, next }))
  const params = new URLSearchParams({
    client_id: 'propusk',
    redirect_uri: REDIRECT_URI(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: await s256(verifier),
    code_challenge_method: 'S256',
  })
  // В жизни здесь был бы https://id.romashka.example/authorize — страница на другом домене.
  return `${BASE}/romashka/authorize?${params}`
}

/** Вернулись с кодом: сверить state и отдать данные для обмена кода. */
export function finishRomashkaLogin(search: URLSearchParams) {
  const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { state: string; nonce: string; verifier: string; next: string } | null
  sessionStorage.removeItem(KEY) // одноразово
  const error = search.get('error')
  if (error) throw new Error(error === 'access_denied' ? 'Вы отказались входить через Ромашка ID' : `Ромашка ID: ${error}`)
  if (!saved || saved.state !== search.get('state')) {
    throw new Error('Попытка входа не совпала (state). Начните вход заново со страницы входа.')
  }
  return { code: search.get('code') ?? '', codeVerifier: saved.verifier, nonce: saved.nonce, next: saved.next }
}
