/**
 * Скриншоты для README: npm run build && node scripts/screenshots.mjs
 * Chrome (Playwright), WebP кодирует сам браузер.
 */
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

import { chromium } from '@playwright/test'

const PORT = 4176
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
await sleep(1500)
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ channel: 'chrome' })

async function shot(name, { theme = 'light', width = 1440, height = 960, mobile = false, steps }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 3 : 2, isMobile: mobile, hasTouch: mobile, colorScheme: theme, locale: 'ru-RU' })
  const page = await context.newPage()
  await steps(page)
  await sleep(700)
  const png = await page.screenshot()
  await writeFile(`docs/screenshots/${name}.webp`, await toWebp(page, png, mobile ? 780 : 1600))
  await context.close()
  console.log('✓', name)
}

async function open(page, path) {
  await page.goto(base + path)
  await page.locator('.boot').waitFor({ state: 'detached' })
}

async function login(page, email) {
  await open(page, '/login')
  await page.getByLabel('Почта').fill(email)
  await page.getByLabel('Пароль').fill('весенний-ключ-2026')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
}

await shot('login', { steps: async (p) => { await open(p, '/login'); await p.getByText('Демо-аккаунты').click() } })
await shot('login-dark', { theme: 'dark', steps: (p) => open(p, '/login') })
await shot('mfa', { theme: 'dark', steps: async (p) => { await login(p, 'admin@propusk.dev'); await p.waitForURL(/mfa/) } })
await shot('security', { steps: async (p) => { await login(p, 'anna@propusk.dev'); await p.getByRole('heading', { name: /Здравствуйте/ }).waitFor(); await p.getByRole('link', { name: 'Безопасность' }).click(); await p.getByRole('button', { name: 'Включить' }).click(); await p.getByRole('img', { name: /QR/ }).waitFor() } })
await shot('under-the-hood', { theme: 'dark', height: 1200, steps: async (p) => {
  await login(p, 'anna@propusk.dev'); await p.getByRole('heading', { name: /Здравствуйте/ }).waitFor()
  await p.getByRole('link', { name: 'Под капотом' }).click()
  await p.getByRole('button', { name: 'Испортить токен' }).click(); await p.getByRole('button', { name: 'Запросить /me' }).click(); await sleep(900)
} })
await shot('sessions', { steps: async (p) => { await login(p, 'anna@propusk.dev'); await p.getByRole('heading', { name: /Здравствуйте/ }).waitFor(); await p.getByRole('link', { name: 'Устройства' }).click() } })
await shot('romashka', { steps: async (p) => { await open(p, '/login'); await p.getByRole('button', { name: 'Войти через Ромашка ID' }).click(); await p.getByText('Иван Лесной').click() } })
await shot('mobile', { mobile: true, width: 390, height: 844, steps: async (p) => { await login(p, 'anna@propusk.dev'); await p.getByRole('heading', { name: /Здравствуйте/ }).waitFor() } })

await browser.close()
server.kill()

async function toWebp(page, png, width) {
  const base64 = await page.evaluate(async ({ data, width }) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(width, Math.round((bitmap.height * width) / bitmap.width))
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const buffer = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })).arrayBuffer())
    let binary = ''
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000))
    return btoa(binary)
  }, { data: png.toString('base64'), width })
  return Buffer.from(base64, 'base64')
}
