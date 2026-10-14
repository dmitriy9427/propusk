/**
 * Пользователи — только для администратора. Прятать раздел в меню — для
 * удобства; защищает сервер: /api/admin отвечает 403 всем, кроме admin.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '@/auth/http'
import { useUser } from '@/auth/session-store'
import { Alert, Badge, Button, Card } from '@/ui'
import type { PublicUser } from '@server/core.ts'

import s from './account.module.css'
import { formatAgo } from './format'
import { keys } from './queries'

type AdminUser = PublicUser & { blocked: boolean; sessions: number; lastLoginAt: number | null }

export function AdminPage() {
  const me = useUser()
  const client = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: keys.users, queryFn: () => api<AdminUser[]>('/admin/users') })
  const [error, setError] = useState('')
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { blocked?: boolean; role?: 'user' | 'admin' } }) => api(`/admin/users/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.users }),
    onError: (e) => setError(e.message),
  })

  return (
    <div className={s.page}>
      <h1 className={s.title}>Пользователи</h1>
      <p className={s.lead}>Блокировка и смена роли сразу завершают все сессии пользователя: права в уже выданных токенах устаревают.</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Защита</th>
                <th>Сессии</th>
                <th>Последний вход</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.name}</b> {u.role === 'admin' && <Badge tone="warn">admin</Badge>} {u.blocked && <Badge tone="danger">заблокирован</Badge>}
                    <br />
                    <span className={s.muted}>{u.email}</span>
                  </td>
                  <td>
                    {u.totpEnabled && <Badge tone="ok">2FA</Badge>} {u.passkeys > 0 && <Badge tone="ok">ключ</Badge>} {!u.emailVerified && <Badge>почта не подтверждена</Badge>}
                  </td>
                  <td>{u.sessions}</td>
                  <td className={s.muted}>{u.lastLoginAt ? formatAgo(u.lastLoginAt) : '—'}</td>
                  <td>
                    {u.id !== me?.id && (
                      <span className={s.row} style={{ justifyContent: 'flex-end' }}>
                        <Button variant="ghost" onClick={() => update.mutate({ id: u.id, patch: { role: u.role === 'admin' ? 'user' : 'admin' } })}>
                          {u.role === 'admin' ? 'Снять админа' : 'Сделать админом'}
                        </Button>
                        <Button variant={u.blocked ? 'secondary' : 'danger'} onClick={() => update.mutate({ id: u.id, patch: { blocked: !u.blocked } })}>
                          {u.blocked ? 'Разблокировать' : 'Заблокировать'}
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
