/** Журнал событий безопасности: входы, неудачные попытки, изменения настроек. */
import { Card } from '@/ui'

import s from './account.module.css'
import { describeDevice, formatDateTime } from './format'
import { useActivity } from './queries'

const LABELS: Record<string, string> = {
  register: 'Регистрация',
  'email-verified': 'Почта подтверждена',
  login: 'Вход',
  'login-failed': 'Неудачная попытка входа',
  locked: 'Вход временно заблокирован',
  logout: 'Выход',
  'session-revoked': 'Сессия завершена',
  'refresh-reuse': '⚠️ Повтор старого токена — сессия завершена',
  'password-changed': 'Пароль изменён',
  'password-reset': 'Пароль сброшен по ссылке',
  'totp-enabled': '2FA включена',
  'totp-disabled': '2FA выключена',
  'recovery-used': 'Вход по коду восстановления',
  'passkey-added': 'Добавлен ключ доступа',
  'passkey-removed': 'Удалён ключ доступа',
  'identity-linked': 'Привязан вход через Ромашка ID',
  'role-changed': 'Изменена роль',
  blocked: 'Заблокирован администратором',
  unblocked: 'Разблокирован',
}

const DANGER = new Set(['login-failed', 'locked', 'refresh-reuse', 'totp-disabled', 'blocked'])

export function ActivityPage() {
  const { data = [] } = useActivity()
  return (
    <div className={s.page}>
      <h1 className={s.title}>Журнал</h1>
      <p className={s.lead}>Последние 100 событий безопасности. Красным — то, на что стоит обратить внимание.</p>
      <Card>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Событие</th>
                <th>Устройство</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} style={DANGER.has(e.type) ? { color: 'var(--danger)' } : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.at)}</td>
                  <td>
                    {LABELS[e.type] ?? e.type}
                    {e.details && <span className={s.muted}> — {e.details}</span>}
                  </td>
                  <td className={s.muted}>{describeDevice(e.userAgent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
