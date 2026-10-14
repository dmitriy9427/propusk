import { describe, expect, it } from 'vitest'

import { safeNext } from './next'

describe('safeNext — защита от открытого редиректа', () => {
  it.each([
    ['/security', '/security'],
    ['/sessions?tab=1', '/sessions?tab=1'],
    [null, '/'],
    ['https://evil.example', '/'],
    ['//evil.example/login', '/'], // адрес без протокола — это другой сайт!
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected)
  })
})
