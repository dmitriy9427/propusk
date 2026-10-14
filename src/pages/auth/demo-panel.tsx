/**
 * Демо-аккаунты на странице входа: подставить почту и пароль одной кнопкой.
 * У администратора включена 2FA — панель показывает его ТЕКУЩИЙ код, посчитанный
 * тем же алгоритмом, что у приложения-аутентификатора (server/lib/totp.ts).
 * В настоящем сервисе такого, конечно, нет: секрет знает только телефон.
 */
import { useEffect, useState } from 'react'

import { totp } from '@server/lib/totp.ts'
import { DEMO_ADMIN_TOTP, DEMO_PASSWORD } from '@server/seed.ts'

import s from './demo-panel.module.css'

const ACCOUNTS = [
  { email: 'anna@propusk.dev', label: 'Анна', note: 'обычный пользователь' },
  { email: 'admin@propusk.dev', label: 'Олег', note: 'администратор, 2FA' },
  { email: 'boris@propusk.dev', label: 'Борис', note: 'заблокирован' },
]

export function DemoPanel({ onPick }: { onPick: (email: string, password: string) => void }) {
  const code = useLiveTotp(DEMO_ADMIN_TOTP)
  return (
    <details className={s.panel}>
      <summary>Демо-аккаунты</summary>
      <p className={s.text}>
        Пароль у всех: <code>{DEMO_PASSWORD}</code>
      </p>
      <ul className={s.list}>
        {ACCOUNTS.map((a) => (
          <li key={a.email}>
            <button type="button" className={s.pick} onClick={() => onPick(a.email, DEMO_PASSWORD)}>
              <b>{a.label}</b> <span>{a.note}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className={s.text}>
        Код 2FA Олега сейчас: <code className={s.code}>{code.value}</code>{' '}
        <span className={s.left}>ещё {code.left} с</span>
      </p>
      <p className={s.text}>
        Коды восстановления Олега: <code>DEMO-AAAA</code>, <code>DEMO-BBBB</code>
      </p>
    </details>
  )
}

/** Код TOTP, который сам меняется каждые 30 секунд. */
export function useLiveTotp(secret: string) {
  const [state, setState] = useState({ value: '······', left: 30 })
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const now = Date.now()
      const value = await totp(secret, now)
      if (alive) setState({ value, left: 30 - (Math.floor(now / 1000) % 30) })
    }
    void tick()
    const id = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [secret])
  return state
}
