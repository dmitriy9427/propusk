/**
 * Демо-данные: три аккаунта Пропуска и два аккаунта «Ромашка ID».
 * Пароли и секрет 2FA — открыто показаны на странице входа демо: это учебный
 * проект, украсть тут нечего.
 */
import { CONFIG } from './config.ts'
import type { Deps } from './context.ts'
import { type Data, type User, emptyData } from './db.ts'
import { hashPassword, randomToken, sha256 } from './lib/crypto.ts'

export const DEMO_PASSWORD = 'весенний-ключ-2026'
/** Секрет 2FA администратора — демо-страница входа показывает по нему текущий код. */
export const DEMO_ADMIN_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
export const DEMO_RECOVERY = ['DEMO-AAAA', 'DEMO-BBBB']

export async function createSeed(now: number, iterations: number = CONFIG.pbkdf2Iterations): Promise<Data> {
  const data = emptyData()
  data.jwtSecret = randomToken(32)
  const hash = await hashPassword(DEMO_PASSWORD, iterations)
  const base: Omit<User, 'id' | 'email' | 'name' | 'role'> = {
    emailVerified: true,
    passwordHash: hash,
    blocked: false,
    createdAt: now - 40 * 86_400_000,
    totp: null,
    pendingTotpSecret: null,
    recoveryCodes: [],
    failedLogins: 0,
    lockedUntil: 0,
    identities: [],
  }
  data.users.push(
    { ...base, id: 'u-anna', email: 'anna@propusk.dev', name: 'Анна Соколова', role: 'user' },
    {
      ...base,
      id: 'u-admin',
      email: 'admin@propusk.dev',
      name: 'Олег Админов',
      role: 'admin',
      totp: { secret: DEMO_ADMIN_TOTP, enabledAt: now - 30 * 86_400_000, lastCounter: -1 },
      recoveryCodes: await Promise.all(DEMO_RECOVERY.map(sha256)),
    },
    { ...base, id: 'u-boris', email: 'boris@propusk.dev', name: 'Борис Блоков', role: 'user', blocked: true },
  )
  data.provider.users.push(
    { id: 'rm-ivan', email: 'ivan@romashka.example', name: 'Иван Лесной' },
    // Та же почта, что у Анны: вход через Ромашку привяжется к её аккаунту.
    { id: 'rm-anna', email: 'anna@propusk.dev', name: 'Анна Соколова' },
  )
  return data
}

export async function ensureSeed(deps: Deps) {
  if (deps.db.data.jwtSecret) return
  deps.db.data = await createSeed(deps.now(), deps.pbkdf2Iterations)
  deps.db.changed()
}
