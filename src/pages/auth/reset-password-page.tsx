import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { ApiError } from '@/auth/errors'
import { api } from '@/auth/http'
import { Alert, Button, Field, Input } from '@/ui'
import { passwordSchema } from '@shared/schemas.ts'

import s from './auth.module.css'
import { PasswordMeter } from './password-meter'

/** Новый пароль по ссылке из письма. После смены все устройства выходят. */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const [token] = useState(() => params.get('token') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = passwordSchema.safeParse(password)
    if (!parsed.success) return setError(parsed.error.issues[0]!.message)
    setBusy(true)
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password }, noRefresh: true })
      history.replaceState(null, '', location.pathname)
      setDone(true)
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className={s.form}>
        <h1 className={s.title}>Пароль изменён</h1>
        <Alert tone="success">Все устройства вышли из аккаунта — на случай, если пароль меняли из-за утечки.</Alert>
        <Link to="/login">Войти с новым паролем</Link>
      </div>
    )
  }

  return (
    <>
      <h1 className={s.title}>Новый пароль</h1>
      <form className={s.form} onSubmit={submit} noValidate>
        <Field label="Новый пароль" error={error} hint={<PasswordMeter value={password} />}>
          {(a11y) => <Input {...a11y} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
        </Field>
        <Button type="submit" variant="primary" block loading={busy}>
          Сохранить
        </Button>
      </form>
    </>
  )
}
