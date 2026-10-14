import { describe, expect, it } from 'vitest'

import { passwordSchema, passwordStrength, recoveryCodeSchema, registerSchema } from './schemas.ts'

const message = (value: string) => passwordSchema.safeParse(value).error?.issues[0]?.message

describe('правила пароля (одни для формы и сервера)', () => {
  it('длина важнее «сложности»: длинная фраза проходит, короткий «Pa$$w0rd» — нет', () => {
    expect(message('весенний ключ от дома')).toBeUndefined()
    expect(message('Pa$$w0rd')).toBe('Не короче 10 символов')
  })

  it('пароли из утечек и однообразные отклоняются', () => {
    expect(message('1234567890')).toMatch(/распространён/)
    expect(message('aaaaaaaaaaaa')).toMatch(/однообразно/)
  })

  it('пароль не должен содержать почту (если имя ящика длиннее 3 символов)', () => {
    const r = registerSchema.safeParse({ email: 'katerina@mail.test', name: 'Катя', password: 'katerina-2026-пароль' })
    expect(r.error?.issues[0]?.path).toEqual(['password'])
    expect(registerSchema.safeParse({ email: 'k@mail.test', name: 'К', password: 'kakoy-to parol' }).success).toBe(true)
  })

  it('код восстановления: регистр и дефис не важны', () => {
    expect(recoveryCodeSchema.parse('demoaaaa')).toBe('DEMO-AAAA')
  })

  it('индикатор надёжности', () => {
    expect(passwordStrength('short')).toBe(0)
    expect(passwordStrength('Весенний ключ от дома 2026!')).toBe(4)
  })
})
