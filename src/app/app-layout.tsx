/**
 * Каркас закрытой части: шапка с разделами, страница, окно подтверждения
 * личности и демо-почта. Сюда попадают только вошедшие (см. routes.tsx).
 */
import { useQueryClient } from '@tanstack/react-query'
import { Activity, Cpu, LogOut, MonitorSmartphone, ShieldCheck, User, Users } from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'

import { logout, scheduleRefresh } from '@/auth/session'
import { useSession } from '@/auth/session-store'
import { MailButton } from '@/pages/mail/mail-button'
import { cx } from '@/ui'

import s from './app-layout.module.css'
import { StepUpDialog } from './step-up-dialog'

const NAV = [
  { to: '/', label: 'Профиль', Icon: User, end: true },
  { to: '/security', label: 'Безопасность', Icon: ShieldCheck },
  { to: '/sessions', label: 'Устройства', Icon: MonitorSmartphone },
  { to: '/activity', label: 'Журнал', Icon: Activity },
  { to: '/under-the-hood', label: 'Под капотом', Icon: Cpu },
]

export function AppLayout() {
  const session = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { pathname } = useLocation()

  // Сессия закончилась (выход в другой вкладке, отзыв, кража токена) — на вход.
  useEffect(() => {
    if (session.status === 'anonymous') {
      queryClient.clear() // личные данные из кеша — прочь
      navigate(`/login?next=${encodeURIComponent(pathname)}`, { replace: true })
    }
    if (session.status === 'authenticated') scheduleRefresh()
  }, [session, navigate, queryClient, pathname])

  if (session.status !== 'authenticated') return null
  const { user } = session

  return (
    <div className={s.shell}>
      <header className={s.header}>
        <NavLink to="/" className={s.brand}>
          <span className={s.logo} aria-hidden>
            П
          </span>
          <span className={s.brandText}>Пропуск</span>
        </NavLink>
        <nav aria-label="Разделы" className={s.nav}>
          {[...NAV, ...(user.role === 'admin' ? [{ to: '/admin', label: 'Пользователи', Icon: Users, end: false }] : [])].map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx(s.link, isActive && s.active)}>
              <Icon aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className={s.user}>
          <span className={s.avatar} aria-hidden>
            {user.name[0]}
          </span>
          <span className={s.userName}>{user.name}</span>
          <button type="button" className={s.logout} onClick={() => void logout()} aria-label="Выйти" title="Выйти">
            <LogOut />
          </button>
        </div>
      </header>
      <main className={s.main}>
        <Outlet />
      </main>
      <StepUpDialog />
      <MailButton />
    </div>
  )
}
