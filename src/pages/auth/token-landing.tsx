/**
 * Страницы, на которые ведут ссылки из писем: /verify-email и /magic.
 * Токен приходит в адресе (?token=…). Сразу убираем его из адреса, чтобы он
 * не остался в истории браузера и не утёк через заголовок Referer.
 */
import { CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { api } from '@/auth/http'
import { type LoginResult, completeLogin, needsMfa, setMfaTicket } from '@/auth/session'

import s from './auth.module.css'

function useTokenFromUrl() {
  const [params] = useSearchParams()
  const [token] = useState(() => params.get('token') ?? '')
  useEffect(() => {
    history.replaceState(null, '', location.pathname) // убрать ?token из адреса
  }, [])
  return token
}

/** Запустить действие один раз (StrictMode вызывает эффекты дважды — ссылка одноразовая!). */
function useOnce(fn: () => void) {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    fn()
  })
}

export function VerifyEmailPage() {
  const token = useTokenFromUrl()
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null)
  useOnce(() => {
    api<{ email: string }>('/auth/verify-email', { method: 'POST', body: { token }, noRefresh: true })
      .then((r) => setState({ ok: true, text: `Почта ${r.email} подтверждена. Теперь можно войти.` }))
      .catch((e: Error) => setState({ ok: false, text: e.message }))
  })
  return <Result state={state} action={<Link to="/login">Ко входу</Link>} />
}

export function MagicLandingPage() {
  const token = useTokenFromUrl()
  const navigate = useNavigate()
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null)
  useOnce(() => {
    api<LoginResult>('/auth/magic-link/verify', { method: 'POST', body: { token }, noRefresh: true })
      .then((result) => {
        if (needsMfa(result)) {
          setMfaTicket(result.ticket)
          navigate('/login/mfa', { replace: true })
        } else {
          completeLogin(result)
          navigate('/', { replace: true })
        }
      })
      .catch((e: Error) => setState({ ok: false, text: e.message }))
  })
  return <Result state={state} action={<Link to="/magic-link">Запросить новую ссылку</Link>} />
}

function Result({ state, action }: { state: { ok: boolean; text: string } | null; action: React.ReactNode }) {
  if (!state) return <p className={s.lead}>Проверяем ссылку…</p>
  return (
    <div className={s.form}>
      {state.ok ? <CheckCircle2 size={40} color="var(--accent)" aria-hidden /> : <XCircle size={40} color="var(--danger)" aria-hidden />}
      <h1 className={s.title}>{state.ok ? 'Готово' : 'Ссылка не сработала'}</h1>
      <p className={s.lead}>{state.text}</p>
      {action}
    </div>
  )
}
