/**
 * Вход. Четыре способа: пароль, ключ доступа, «Ромашка ID», ссылка на почту.
 * После пароля сервер может ответить «нужен второй шаг» — тогда переходим на
 * /login/mfa с билетом.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { Fingerprint, Flower2, Mail } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { z } from 'zod'

import { isApiError } from '@/auth/errors'
import { api } from '@/auth/http'
import { safeNext } from '@/auth/next'
import { passkeyError, passkeysSupported, signInWithPasskey } from '@/auth/passkey'
import { startRomashkaLogin } from '@/auth/romashka'
import { type LoginResult, completeLogin, needsMfa, setMfaTicket } from '@/auth/session'
import { useSession } from '@/auth/session-store'
import { Alert, Button, Field, Input } from '@/ui'
import { loginSchema } from '@shared/schemas.ts'

import s from './auth.module.css'
import { DemoPanel } from './demo-panel'

type Values = z.infer<typeof loginSchema>

export function LoginPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const session = useSession()
  const [notice, setNotice] = useState<{ tone: 'danger' | 'warning'; text: string; resend?: string } | null>(null)
  const [passkeyBusy, setPasskeyBusy] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

  /** Ответ сервера после первого шага: сразу сессия или нужен код. */
  function handleResult(result: LoginResult) {
    if (needsMfa(result)) {
      setMfaTicket(result.ticket)
      navigate(`/login/mfa?next=${encodeURIComponent(next)}`)
      return
    }
    completeLogin(result)
    navigate(next, { replace: true })
  }

  async function onSubmit(values: Values) {
    setNotice(null)
    try {
      handleResult(await api<LoginResult>('/auth/login', { method: 'POST', body: values, noRefresh: true }))
    } catch (error) {
      if (isApiError(error, 'email-not-verified')) setNotice({ tone: 'warning', text: error.message, resend: values.email })
      else if (isApiError(error, 'invalid')) Object.entries(error.fields).forEach(([k, m]) => setError(k as keyof Values, { message: m }))
      else setNotice({ tone: 'danger', text: (error as Error).message })
    }
  }

  async function onPasskey() {
    setNotice(null)
    setPasskeyBusy(true)
    try {
      handleResult(await signInWithPasskey<LoginResult>())
    } catch (error) {
      setNotice({ tone: 'danger', text: passkeyError(error) })
    } finally {
      setPasskeyBusy(false)
    }
  }

  async function resend(email: string) {
    await api('/auth/resend-verification', { method: 'POST', body: { email }, noRefresh: true })
    setNotice({ tone: 'warning', text: 'Новая ссылка отправлена — откройте «Почту» внизу справа.' })
  }

  return (
    <>
      <h1 className={s.title}>Вход</h1>
      <p className={s.lead}>
        Нет аккаунта? <Link to="/register">Зарегистрируйтесь</Link>
      </p>

      {session.status === 'anonymous' && session.reason && (
        <div style={{ marginTop: 16 }}>
          <Alert tone="warning">{session.reason}</Alert>
        </div>
      )}

      <form className={s.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field label="Почта" error={errors.email?.message}>
          {(a11y) => <Input {...a11y} {...register('email')} type="email" autoComplete="username" inputMode="email" />}
        </Field>
        <Field label="Пароль" error={errors.password?.message}>
          {(a11y) => <Input {...a11y} {...register('password')} type="password" autoComplete="current-password" />}
        </Field>

        {notice && (
          <Alert tone={notice.tone}>
            {notice.text}{' '}
            {notice.resend && (
              <button type="button" className="link-button" onClick={() => resend(notice.resend!)}>
                Отправить ссылку ещё раз
              </button>
            )}
          </Alert>
        )}

        <Button type="submit" variant="primary" block loading={isSubmitting}>
          Войти
        </Button>
        <div className={s.links}>
          <Link to="/forgot-password">Забыли пароль?</Link>
          <Link to="/magic-link">
            <Mail size={14} aria-hidden /> Войти по ссылке на почту
          </Link>
        </div>

        <div className={s.or}>или</div>
        <div className={s.alternatives}>
          {passkeysSupported() && (
            <Button icon={<Fingerprint />} block onClick={onPasskey} loading={passkeyBusy}>
              Войти по ключу доступа
            </Button>
          )}
          <Button icon={<Flower2 />} block onClick={async () => (location.href = await startRomashkaLogin(next))}>
            Войти через Ромашка ID
          </Button>
        </div>
      </form>

      <DemoPanel
        onPick={(email, password) => {
          setValue('email', email)
          setValue('password', password)
        }}
      />
    </>
  )
}
