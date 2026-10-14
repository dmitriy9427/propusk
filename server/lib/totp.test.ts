// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { base32Decode, base32Encode, hotp, totp, verifyTotp } from './totp.ts'

// Секрет из RFC 6238 (приложение B): ASCII «12345678901234567890».
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'))

describe('TOTP', () => {
  it('base32 туда и обратно', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(new TextDecoder().decode(base32Decode(RFC_SECRET))).toBe('12345678901234567890')
  })

  it('коды совпадают с эталоном из RFC 4226 (HOTP)', async () => {
    // Приложение D RFC 4226: счётчики 0…3.
    expect(await Promise.all([0, 1, 2, 3].map((n) => hotp(RFC_SECRET, n)))).toEqual(['755224', '287082', '359152', '969429'])
  })

  it('TOTP в момент 59 с — счётчик 1 → 287082 (RFC 6238, 6 цифр)', async () => {
    expect(await totp(RFC_SECRET, 59_000)).toBe('287082')
  })

  it('принимает соседний интервал (±30 с), но не дальше; один код — один раз', async () => {
    const now = 1_000_000_000_000
    const code = await totp(RFC_SECRET, now)
    expect(await verifyTotp(RFC_SECRET, code, now + 30_000)).not.toBeNull()
    expect(await verifyTotp(RFC_SECRET, code, now + 90_000)).toBeNull()
    const used = await verifyTotp(RFC_SECRET, code, now)
    expect(await verifyTotp(RFC_SECRET, code, now, used!)).toBeNull() // повтор не принимаем
  })
})
