/**
 * Сервер целиком — одно приложение Hono. Hono работает на стандартных
 * Request/Response, поэтому один и тот же код запускается:
 *   - в Node (server/index.ts) — настоящий сервер с настоящими cookie;
 *   - в браузере (src/mocks/browser.ts) — MSW отдаёт запросы в app.fetch().
 */
import { Hono } from 'hono'

import type { AppEnv, Deps } from './context.ts'
import { ApiError } from './lib/http.ts'
import { ensureProviderKeys, providerRoutes } from './provider/provider.ts'
import { adminRoutes } from './routes/admin.ts'
import { authRoutes } from './routes/auth.ts'
import { meRoutes } from './routes/me.ts'
import { oauthRoutes } from './routes/oauth.ts'
import { ensureSeed } from './seed.ts'

export async function createApp(deps: Deps) {
  await ensureSeed(deps)
  await ensureProviderKeys(deps)

  const provider = providerRoutes(deps)
  const app = new Hono<AppEnv>()

  app.use(async (c, next) => {
    c.set('deps', deps)
    await next()
    // Ответы API не кешируются: в них личные данные и токены.
    c.header('Cache-Control', 'no-store')
  })

  app.route('/api/auth', authRoutes(deps))
  app.route('/api/auth/oauth', oauthRoutes(deps, provider))
  app.route('/api/me', meRoutes(deps))
  app.route('/api/admin', adminRoutes(deps))
  app.route('/provider', provider)

  /**
   * Демо-почта: на настоящем сервере письма уходят по SMTP, а здесь лежат
   * в базе, и их показывает страница «Почта». В продакшене этого маршрута нет.
   */
  app.get('/api/dev/mail', (c) => c.json(deps.db.data.mails))
  app.delete('/api/dev/mail', (c) => {
    deps.db.data.mails = []
    deps.db.changed()
    return c.json({ ok: true })
  })

  app.notFound((c) => c.json({ code: 'not-found', message: 'Нет такого адреса' }, 404))

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      if (error.retryAfter) c.header('Retry-After', String(error.retryAfter))
      return c.json({ code: error.code, message: error.message, fields: error.fields }, error.status)
    }
    console.error('[propusk]', error)
    return c.json({ code: 'server-error', message: 'Ошибка сервера' }, 500)
  })

  return app
}
