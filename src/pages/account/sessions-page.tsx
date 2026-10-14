/**
 * Устройства = активные сессии. Завершить сессию — значит отозвать её
 * refresh-токен; access-токен того устройства перестанет работать сразу,
 * потому что сервер проверяет сессию на каждом запросе (server/core.ts).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Monitor, Smartphone } from 'lucide-react'

import { api } from '@/auth/http'
import { Badge, Button, Card } from '@/ui'

import s from './account.module.css'
import { METHOD_LABEL, describeDevice, formatAgo, formatDateTime } from './format'
import { keys, useSessions } from './queries'

export function SessionsPage() {
  const { data: sessions = [], isLoading } = useSessions()
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: keys.sessions })
  const revoke = useMutation({ mutationFn: (id: string) => api(`/me/sessions/${id}`, { method: 'DELETE' }), onSuccess: refresh })
  const revokeOthers = useMutation({ mutationFn: () => api('/me/sessions/revoke-others', { method: 'POST' }), onSuccess: refresh })
  const others = sessions.filter((x) => !x.current).length

  return (
    <div className={s.page}>
      <h1 className={s.title}>Устройства</h1>
      <p className={s.lead}>Где вы сейчас вошли. Не узнаёте устройство — завершите его сессию и смените пароль.</p>
      <Card
        title={`Активных сессий: ${sessions.length}`}
        action={
          others > 0 && (
            <Button variant="danger" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
              Завершить все другие
            </Button>
          )
        }
      >
        {isLoading && <p>Загружаем…</p>}
        <ul className={s.list}>
          {sessions.map((session) => {
            const mobile = /iPhone|Android/.test(session.userAgent)
            const Icon = mobile ? Smartphone : Monitor
            return (
              <li key={session.id}>
                <Icon aria-hidden size={22} color="var(--muted)" />
                <div className={s.grow}>
                  <b>
                    {describeDevice(session.userAgent)} {session.current && <Badge tone="ok">это устройство</Badge>}
                  </b>
                  <span className={s.muted}>
                    Вход {formatDateTime(session.createdAt)} ({METHOD_LABEL[session.method] ?? session.method}) · активность {formatAgo(session.lastUsedAt)}
                  </span>
                </div>
                {!session.current && (
                  <Button variant="ghost" loading={revoke.isPending && revoke.variables === session.id} onClick={() => revoke.mutate(session.id)}>
                    Завершить
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
      <Card title="Попробуйте">
        <p className={s.muted}>
          Откройте этот сайт в другом браузере или в режиме инкогнито и войдите. Здесь появится второе устройство. Нажмите «Завершить» — в той вкладке
          следующий же запрос вернёт «Сессия завершена», и откроется вход.
        </p>
      </Card>
    </div>
  )
}
