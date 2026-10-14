/**
 * TOTP — одноразовые коды из приложения-аутентификатора (RFC 6238).
 *
 * Как это работает:
 *   1. Сервер придумывает секрет (20 случайных байт) и показывает его QR-кодом.
 *   2. Приложение на телефоне сохраняет секрет. Теперь секрет знают двое.
 *   3. Каждые 30 секунд обе стороны считают HMAC-SHA1(секрет, номер_интервала)
 *      и берут из результата 6 цифр. Сеть для этого не нужна — только часы.
 *   4. Совпало — значит, телефон у того, кто вводит код.
 *
 * Номер интервала = floor(время / 30). Часы телефона и сервера расходятся,
 * поэтому принимаем и соседние интервалы (±1, то есть ±30 секунд).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Base32 — формат, в котором секрет понимают все приложения-аутентификаторы. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase()
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) throw new Error('Неверный символ base32')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)))
}

/** HOTP (RFC 4226): код для номера `counter`. TOTP — это HOTP, где counter = время / 30. */
export async function hotp(secret: string, counter: number, digits = 6): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  // Счётчик — 8 байт, старшим байтом вперёд.
  const message = new ArrayBuffer(8)
  new DataView(message).setBigUint64(0, BigInt(counter))
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  // «Динамическое усечение»: последние 4 бита говорят, с какого байта брать 4 байта.
  const offset = mac[mac.length - 1]! & 0x0f
  const number =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!
  return String(number % 10 ** digits).padStart(digits, '0')
}

export const totpCounter = (now: number, step = 30) => Math.floor(now / 1000 / step)

export function totp(secret: string, now = Date.now()): Promise<string> {
  return hotp(secret, totpCounter(now))
}

/**
 * Проверить код. Возвращает номер интервала, которым код подошёл, — его надо
 * запомнить и больше не принимать (иначе подсмотренный код можно повторить
 * в течение тех же 30 секунд). null — не подошёл.
 */
export async function verifyTotp(secret: string, code: string, now = Date.now(), lastUsedCounter = -1): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null
  const current = totpCounter(now)
  for (const counter of [current, current - 1, current + 1]) {
    if (counter <= lastUsedCounter) continue
    if ((await hotp(secret, counter)) === code) return counter
  }
  return null
}

/** Ссылка otpauth:// — её и кодирует QR. Приложение возьмёт из неё название и секрет. */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

/** Коды восстановления: 10 штук вида «7KQ2-M9XA», каждый — одноразовый. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(crypto.getRandomValues(new Uint8Array(5))).slice(0, 8)
    return `${raw.slice(0, 4)}-${raw.slice(4)}`
  })
}
