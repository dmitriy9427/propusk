import { defineConfig, devices } from '@playwright/test'

/**
 * E2E: собранное приложение в настоящем браузере. Сервер — тот же Hono в MSW,
 * что на GitHub Pages. Passkeys проверяются виртуальным аутентификатором Chrome.
 */
const local = !process.env.CI

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !local,
  retries: local ? 0 : 1,
  reporter: local ? 'list' : [['github'], ['html', { open: 'never' }]],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4175',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: local ? 'chrome' : undefined }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: local ? 'chrome' : undefined }, grep: /@mobile/ },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4175 --strictPort',
    url: 'http://localhost:4175',
    reuseExistingServer: local,
    timeout: 180_000,
  },
})
