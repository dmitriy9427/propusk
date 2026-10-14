/**
 * /api/admin — только для роли admin. Права проверяются НА СЕРВЕРЕ:
 * скрытая в интерфейсе кнопка ничего не защищает, запрос можно отправить руками.
 */
import { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv, Deps } from '../context.ts'
import { audit, publicUser, requireAuth, requireRecentAuth, requireRole, revokeAllSessions, userAgent } from '../core.ts'
import { ApiError, parseBody } from '../lib/http.ts'

export function adminRoutes(deps: Deps) {
  const app = new Hono<AppEnv>()
  app.use(requireAuth, requireRole('admin'))

  app.get('/users', (c) => {
    const now = deps.now()
    return c.json(
      deps.db.data.users.map((u) => ({
        ...publicUser(deps, u),
        blocked: u.blocked,
        sessions: deps.db.data.sessions.filter((s) => s.userId === u.id && !s.revokedAt && s.expiresAt > now).length,
        lastLoginAt: deps.db.data.audit.find((e) => e.userId === u.id && e.type === 'login')?.at ?? null,
      })),
    )
  })

  app.patch('/users/:id', async (c) => {
    requireRecentAuth(c)
    const body = await parseBody(c, z.object({ role: z.enum(['user', 'admin']).optional(), blocked: z.boolean().optional() }))
    const target = deps.db.data.users.find((u) => u.id === c.req.param('id'))
    if (!target) throw new ApiError(404, 'not-found', 'Пользователь не найден')
    // Не дать администратору случайно лишить прав или заблокировать самого себя.
    if (target.id === c.var.user.id) throw new ApiError(400, 'self', 'Нельзя менять права или блокировать самого себя')
    if (body.role && body.role !== target.role) {
      target.role = body.role
      // Роль в уже выданных access-токенах старая — завершаем сессии, чтобы права обновились.
      revokeAllSessions(deps, target.id, 'Изменена роль')
      audit(deps, target.id, 'role-changed', userAgent(c), `${body.role} (изменил ${c.var.user.email})`)
    }
    if (body.blocked !== undefined && body.blocked !== target.blocked) {
      target.blocked = body.blocked
      if (body.blocked) revokeAllSessions(deps, target.id, 'Заблокирован')
      audit(deps, target.id, body.blocked ? 'blocked' : 'unblocked', userAgent(c), c.var.user.email)
    }
    deps.db.changed()
    return c.json({ ok: true })
  })

  return app
}
