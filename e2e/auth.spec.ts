import { expect, test } from '@playwright/test'

import { PASSWORD, adminCode, followMailLink, login, open } from './helpers'

test.describe('Пропуск', () => {
  test('регистрация → письмо → подтверждение → вход', async ({ page }) => {
    await open(page, '/register')
    await page.getByLabel('Как к вам обращаться').fill('Катя')
    await page.getByLabel('Почта').fill('kate@mail.test')
    await page.getByLabel('Пароль').fill('длинная фраза для входа')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    await expect(page.getByRole('heading', { name: 'Проверьте почту' })).toBeVisible()

    await followMailLink(page, 'Подтвердите почту')
    await expect(page.getByText(/Почта kate@mail.test подтверждена/)).toBeVisible()

    await login(page, 'kate@mail.test', 'длинная фраза для входа')
    await expect(page.getByRole('heading', { name: 'Здравствуйте, Катя' })).toBeVisible()
  })

  test('закрытая страница → вход → возврат на неё же; сессия переживает перезагрузку', async ({ page }) => {
    await open(page, '/sessions')
    await expect(page).toHaveURL(/\/login\?next=%2Fsessions/)
    await page.getByLabel('Почта').fill('anna@propusk.dev')
    await page.getByLabel('Пароль').fill(PASSWORD)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Устройства' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Устройства' })).toBeVisible()
  })

  test('неверный пароль — общая ошибка; заблокированный — своя', async ({ page }) => {
    await login(page, 'anna@propusk.dev', 'неверный-пароль')
    await expect(page.getByText('Неверная почта или пароль')).toBeVisible()
    await login(page, 'boris@propusk.dev')
    await expect(page.getByText(/заблокирована/)).toBeVisible()
  })

  test('администратор: пароль → код 2FA → раздел «Пользователи»', async ({ page }) => {
    await login(page, 'admin@propusk.dev')
    await expect(page).toHaveURL(/\/login\/mfa/)
    await page.getByLabel('Код из приложения').fill(await adminCode())
    await page.getByRole('button', { name: 'Подтвердить' }).click()
    await page.getByRole('link', { name: 'Пользователи' }).click()
    await expect(page.getByRole('cell', { name: /Борис Блоков/ })).toBeVisible()
  })

  test('обычному пользователю /admin недоступен', async ({ page }) => {
    await login(page, 'anna@propusk.dev')
    await expect(page.getByRole('heading', { name: /Здравствуйте/ })).toBeVisible()
    await open(page, '/admin')
    await expect(page).toHaveURL(/\/$/)
  })

  test('включение 2FA: QR → код → коды восстановления; следующий вход просит код', async ({ page }) => {
    await login(page, 'anna@propusk.dev')
    await page.getByRole('link', { name: 'Безопасность' }).click()
    await page.getByRole('button', { name: 'Включить' }).click()
    await expect(page.getByRole('img', { name: /QR-код/ })).toBeVisible()
    const secret = (await page.getByText(/Ключ вручную/).textContent())!.replace('Ключ вручную:', '').replace(/\s/g, '')
    const { totp } = await import('../server/lib/totp.ts')
    await page.getByLabel('Код из приложения').fill(await totp(secret))
    await page.getByRole('button', { name: 'Включить' }).click()
    await expect(page.getByRole('heading', { name: 'Сохраните коды восстановления' })).toBeVisible()
    await page.getByRole('button', { name: 'Я сохранил' }).click()

    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page).toHaveURL(/\/login/) // дождаться, пока сервер завершит сессию
    await login(page, 'anna@propusk.dev')
    await expect(page).toHaveURL(/\/login\/mfa/)
  })

  test('вход по ссылке из письма', async ({ page }) => {
    await open(page, '/magic-link')
    await page.getByLabel('Почта').fill('anna@propusk.dev')
    await page.getByRole('button', { name: 'Прислать ссылку' }).click()
    await expect(page.getByText(/письмо уже в пути/)).toBeVisible()
    await followMailLink(page, 'Вход в Пропуск')
    await expect(page.getByRole('heading', { name: /Здравствуйте, Анна/ })).toBeVisible()
  })

  test('вход через Ромашка ID (OAuth + PKCE): новый пользователь', async ({ page }) => {
    await open(page, '/login')
    await page.getByRole('button', { name: 'Войти через Ромашка ID' }).click()
    await expect(page.getByText('id.romashka.example/authorize')).toBeVisible()
    await page.getByText('Иван Лесной').click()
    await page.getByRole('button', { name: 'Разрешить' }).click()
    await expect(page.getByRole('heading', { name: 'Здравствуйте, Иван Лесной' })).toBeVisible()
  })

  test('выход в одной вкладке выкидывает и вторую', async ({ page, context }) => {
    await login(page, 'anna@propusk.dev')
    await expect(page.getByRole('heading', { name: /Здравствуйте/ })).toBeVisible()
    const second = await context.newPage()
    await open(second, '/security')
    await expect(second.getByRole('heading', { name: 'Безопасность' })).toBeVisible()
    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(second).toHaveURL(/\/login/)
    await expect(second.getByText('Вы вышли в другой вкладке')).toBeVisible()
  })

  test('испорченный токен: запрос сам обновляет токен и проходит', async ({ page }) => {
    await login(page, 'anna@propusk.dev')
    await page.getByRole('link', { name: 'Под капотом' }).click()
    await page.getByRole('button', { name: 'Испортить токен' }).click()
    await page.getByRole('button', { name: 'Запросить /me' }).click()
    const log = page.getByRole('list').filter({ hasText: '→ GET /me' })
    await expect(log).toContainText('(token-expired)')
    await expect(log).toContainText('↻ повтор /me')
  })

  test('кража refresh-токена: после вора жертва обновляется → сессия завершена для обоих', async ({ page }) => {
    await login(page, 'anna@propusk.dev')
    await page.getByRole('link', { name: 'Под капотом' }).click()
    await page.getByRole('button', { name: 'Украсть cookie' }).click()
    await page.getByRole('button', { name: 'Вор обновляет токен' }).click()
    await expect(page.getByText(/Вор получил новый access-токен/)).toBeVisible()
    await page.getByRole('button', { name: 'Вы обновляете токен' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText(/из соображений безопасности/)).toBeVisible()
  })

  test('ключ доступа: добавить в настройках и войти без пароля', async ({ page }) => {
    // Виртуальный аутентификатор Chrome: «отпечаток» без настоящего сканера.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })
    await login(page, 'anna@propusk.dev')
    await page.getByRole('link', { name: 'Безопасность' }).click()
    await page.getByLabel('Название ключа').fill('Тестовый ноутбук')
    await page.getByRole('button', { name: 'Добавить' }).click()
    await expect(page.getByText('Тестовый ноутбук')).toBeVisible()

    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page).toHaveURL(/\/login\?next=%2Fsecurity/)
    await page.getByRole('button', { name: 'Войти по ключу доступа' }).click()
    // Вход по ключу без почты и пароля — и возврат туда, откуда выходили.
    await expect(page.getByRole('heading', { name: 'Безопасность' })).toBeVisible()
    await expect(page.getByText('Анна Соколова')).toBeVisible()
  })

  test('телефон: страницы без прокрутки вбок @mobile', async ({ page }) => {
    await login(page, 'anna@propusk.dev')
    await expect(page.getByRole('heading', { name: /Здравствуйте/ })).toBeVisible()
    for (const path of ['/', '/security', '/sessions', '/activity', '/under-the-hood', '/login', '/register']) {
      await open(page, path)
      await page.waitForTimeout(300)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, path).toBeLessThanOrEqual(0)
    }
  })
})
