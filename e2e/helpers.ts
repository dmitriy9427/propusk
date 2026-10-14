import { type Page, expect } from '@playwright/test'

import { totp } from '../server/lib/totp.ts'
import { DEMO_ADMIN_TOTP, DEMO_PASSWORD } from '../server/seed.ts'

export const PASSWORD = DEMO_PASSWORD
export const adminCode = () => totp(DEMO_ADMIN_TOTP)

export async function open(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.locator('.boot')).toHaveCount(0, { timeout: 20_000 })
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await open(page, '/login')
  await page.getByLabel('Почта').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
}

/** Открыть демо-почту и перейти по ссылке из последнего письма с такой темой. */
export async function followMailLink(page: Page, subject: string) {
  await page.getByRole('button', { name: /Почта/ }).click()
  const mail = page.getByRole('complementary', { name: 'Демо-почта' }).getByRole('listitem').filter({ hasText: subject }).first()
  await mail.getByRole('link', { name: /Открыть ссылку/ }).click()
}
