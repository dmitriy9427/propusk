/**
 * Криптография на Web Crypto API (crypto.subtle). Он есть и в браузере, и в
 * Node 20+ — поэтому один и тот же сервер работает в демо (MSW) и на Node.
 *
 * Здесь три кирпичика безопасности:
 *   - случайные токены (crypto.getRandomValues — криптостойкий генератор,
 *     в отличие от Math.random);
 *   - хеш паролей PBKDF2 с солью;
 *   - SHA-256 для токенов, которые храним в базе (сам токен не храним).
 */
import { CONFIG } from '../config.ts'

const encoder = new TextEncoder()

/** Байты → base64url (без +, / и =: можно класть в адрес и cookie). */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Случайный токен: 32 байта = 256 бит — подобрать нельзя. */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** Случайный id для записей в базе. */
export const randomId = () => randomToken(12)

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return toBase64Url(new Uint8Array(digest))
}

/**
 * Сравнение строк за постоянное время. Обычное `a === b` прерывается на первом
 * несовпадении: по времени ответа можно угадывать секрет посимвольно.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Хеш пароля: PBKDF2-SHA256 с солью и сотнями тысяч повторов.
 *
 * Почему не просто sha256(пароль): SHA-256 считается миллиарды раз в секунду
 * на видеокарте — утёкшую базу переберут по словарю за минуты. PBKDF2 нарочно
 * медленный (сотни тысяч повторов), а соль (случайные байты на каждого
 * пользователя) не даёт перебирать всю базу одной таблицей.
 *
 * Формат строки: pbkdf2$<повторы>$<соль>$<хеш> — повторы хранятся рядом,
 * чтобы потом можно было увеличить их, не ломая старые пароли.
 */
export async function hashPassword(password: string, iterations: number = CONFIG.pbkdf2Iterations): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, iterations)
  return `pbkdf2$${iterations}$${toBase64Url(salt)}$${hash}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, expected] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iterations || !salt || !expected) return false
  const actual = await pbkdf2(password, fromBase64Url(salt), Number(iterations))
  return safeEqual(actual, expected)
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return toBase64Url(new Uint8Array(bits))
}
