import { Fingerprint, KeyRound, ShieldCheck, Smartphone } from 'lucide-react'
import { Link, Outlet } from 'react-router'

import { MailButton } from '@/pages/mail/mail-button'

import s from './auth.module.css'

const POINTS = [
  { Icon: KeyRound, text: 'Короткий access-токен в памяти и refresh-токен в HttpOnly-cookie с ротацией' },
  { Icon: Smartphone, text: 'Двухфакторная защита: код из приложения и коды восстановления' },
  { Icon: Fingerprint, text: 'Вход по ключу доступа — Touch ID, Face ID, Windows Hello' },
  { Icon: ShieldCheck, text: 'Вход через внешнего провайдера по OAuth 2.0 + PKCE' },
]

/** Раскладка страниц входа: слева — о проекте, справа — форма. */
export function AuthLayout() {
  return (
    <div className={s.layout}>
      <aside className={s.side}>
        <Link to="/" className={s.brand}>
          <span className={s.logo} aria-hidden>
            П
          </span>
          Пропуск
        </Link>
        <h1 className={s.headline}>Авторизация, сделанная как в продукте</h1>
        <ul className={s.points}>
          {POINTS.map(({ Icon, text }) => (
            <li key={text}>
              <Icon aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        <p className={s.note}>Демо: сервер работает прямо в браузере, письма приходят во встроенную почту.</p>
      </aside>
      <main className={s.main}>
        <div className={s.formWrap}>
          <Outlet />
        </div>
      </main>
      <MailButton />
    </div>
  )
}
