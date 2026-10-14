/**
 * Второй шаг входа: код из приложения-аутентификатора или код восстановления.
 * Билет (ticket) получен на первом шаге и лежит в памяти. Перезагрузили
 * страницу — билета нет, вход нужно начать заново (это нарочно).
 */
import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'

import { ApiError } from '@/auth/errors'
import { api } from '@/auth/http'
import { safeNext } from '@/auth/next'
import { type LoginResult, completeLogin, getMfaTicket, needsMfa } from '@/auth/session'
import { Alert, Button, Field, Input } from '@/ui'

import s from './auth.module.css'

export function MfaPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const [mode, setMode] = useState<'code' | 'recovery'>('code')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ticket = getMfaTicket()

  if (!ticket) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = mode === 'code' ? { ticket, code: value } : { ticket, recoveryCode: value }
      const result = await api<LoginResult>('/auth/login/mfa', { method: 'POST', body, noRefresh: true })
      if (!needsMfa(result)) {
        completeLogin(result)
        navigate(next, { replace: true })
      }
    } catch (e) {
      const err = e as ApiError
      if (err.code === 'mfa-expired') navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true })
      setError(Object.values(err.fields ?? {})[0] ?? err.message)
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className={s.title}>Подтверждение входа</h1>
      <p className={s.lead}>
        {mode === 'code'
          ? 'Введите 6 цифр из приложения-аутентификатора (Google Authenticator, Яндекс Ключ, 1Password…).'
          : 'Введите один из кодов восстановления, которые вы сохранили при включении защиты.'}
      </p>
      <form className={s.form} onSubmit={submit} noValidate>
        {mode === 'code' ? (
          <Field label="Код из приложения" error={error}>
            {(a11y) => (
              <Input
                {...a11y}
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                // one-time-code — телефон предложит код из СМС/приложения прямо над клавиатурой.
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="000000"
                className={s.code}
                autoFocus
              />
            )}
          </Field>
        ) : (
          <Field label="Код восстановления" error={error} hint="Формат XXXX-XXXX. Каждый код работает один раз.">
            {(a11y) => <Input {...a11y} value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} autoComplete="off" placeholder="XXXX-XXXX" className={s.code} autoFocus />}
          </Field>
        )}
        <Button type="submit" variant="primary" block loading={busy} disabled={mode === 'code' ? value.length !== 6 : value.length < 8}>
          Подтвердить
        </Button>
        <div className={s.links}>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode(mode === 'code' ? 'recovery' : 'code')
              setValue('')
              setError('')
            }}
          >
            {mode === 'code' ? 'Нет доступа к телефону?' : 'Ввести код из приложения'}
          </button>
          <Link to="/login">Другой аккаунт</Link>
        </div>
        <Alert tone="info">Код меняется каждые 30 секунд. Если не подходит — проверьте, что время на телефоне выставлено автоматически.</Alert>
      </form>
    </>
  )
}
