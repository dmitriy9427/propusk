# 11. Тесты

Авторизацию нельзя проверять «на глаз»: «вход работает» — это не тест. Нужно проверить, что
**не работает** то, что не должно: украденный токен, повторный код, чужой `code_verifier`,
просроченная ссылка.

```bash
npm test        # Vitest: 49 тестов, ~4 секунды
npm run e2e     # Playwright: 13 сценариев в Chrome
npm run check   # линтер, типы, тесты, сборка — то же, что в CI
```

## Сервер: управляемые часы и «банка cookie» — [server/test-utils.ts](../server/test-utils.ts)

Как проверить «ссылка живёт 15 минут», не ожидая 15 минут? Сервер не вызывает `Date.now()`
напрямую: часы передаются в `createApp` (`deps.now`). Тест подставляет свои:

```ts
let now = Date.UTC(2026, 9, 14, 9, 0)
const app = await createApp({ db, now: () => now, …, pbkdf2Iterations: 1000 })
const advance = (ms) => { now += ms }     // «перемотать время»
```

`pbkdf2Iterations: 1000` вместо 600 000 — иначе каждый вход в тесте шёл бы секунду.

«Браузер» в тестах — функция, которая запоминает cookie из `Set-Cookie` и прикладывает их к
следующим запросам, как настоящий браузер:

```ts
const b = t.browser()
await b.post('/api/auth/login', { email: 'anna@propusk.dev', password })   // cookie сохранилась
t.advance(11 * 60_000)                                                      // прошло 11 минут
expect((await b.get('/api/me')).body.code).toBe('token-expired')
await b.refresh()                                                           // cookie приложилась сама
```

Тест кражи токена ([server/auth.test.ts](../server/auth.test.ts)) читается как история:

```ts
const victim = t.browser()
await victim.post('/api/auth/login', …)
const stolen = victim.cookie('propusk_rt')

const thief = t.browser()
thief.setCookie('propusk_rt', stolen)
expect((await thief.refresh()).status).toBe(200)            // вор успел первым

expect((await victim.refresh()).body.code).toBe('refresh-reused')   // жертва — повтор → тревога
expect((await thief.get('/api/me')).status).toBe(401)        // и вор тоже вылетел
```

TOTP проверяется по **эталонным значениям из стандарта** RFC 6238 — так мы уверены, что наш
код совпадёт с любым приложением-аутентификатором.

## Клиент: подменённый fetch — [src/auth/http.test.ts](../src/auth/http.test.ts)

Логику `api()` проверяем без сервера: `fetch` подменён функцией, которая отвечает по сценарию
и записывает, что у неё спросили.

```ts
server((path, init) => {
  if (path === '/auth/refresh') return json(200, { accessToken: 'new', … })
  return init.headers.authorization === 'Bearer new' ? json(200, { ok: true }) : json(401, { code: 'token-expired' })
})
await api('/me')
expect(calls).toEqual(['GET /me', 'POST /auth/refresh', 'GET /me'])
```

`calls` — журнал запросов. По нему видно поведение целиком: запрос → обновление → повтор.

## E2E: настоящий браузер — [e2e/auth.spec.ts](../e2e/auth.spec.ts)

13 сценариев против собранного сайта: регистрация через почту, 2FA, OAuth, выход во всех
вкладках, «испорченный токен», кража refresh-токена, passkeys с виртуальным аутентификатором
([глава 06](06-passkeys.md#как-это-проверяется-без-пальца)), телефон без прокрутки вбок.

Код 2FA в тесте считается той же функцией, что на сервере:

```ts
import { totp } from '../server/lib/totp.ts'
await page.getByLabel('Код из приложения').fill(await totp(DEMO_ADMIN_TOTP))
```

Две вкладки — две страницы одного «контекста» браузера: у них общие cookie, `localStorage` и
BroadcastChannel, как у настоящих вкладок.

```ts
const second = await context.newPage()
await page.getByRole('button', { name: 'Выйти' }).click()
await expect(second.getByText('Вы вышли в другой вкладке')).toBeVisible()
```

## CI — [.github/workflows/pages.yml](../.github/workflows/pages.yml)

На каждый push: линтер → типы → тесты → e2e → сборка с `VITE_BASE=/propusk/` → публикация.
Красный шаг — сайт не обновится.
