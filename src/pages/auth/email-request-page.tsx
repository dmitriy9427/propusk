/**
 * Две похожие страницы: «Войти по ссылке» и «Забыли пароль». Обе просят почту
 * и отвечают одинаково — есть такая почта или нет (защита от перебора почт).
 */
import { useState } from 'react'
import { Link } from 'react-router'

import { ApiError } from '@/auth/errors'
import { api } from '@/auth/http'
import { Alert, Button, Field, Input } from '@/ui'
import { emailSchema } from '@shared/schemas.ts'

import s from './auth.module.css'

interface Props {
  title: string
  lead: string
  endpoint: '/auth/magic-link' | '/auth/password/forgot'
  button: string
}

function EmailRequestPage({ title, lead, endpoint, button }: Props) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) return setError(parsed.error.issues[0]!.message)
    setBusy(true)
    setError('')
    try {
      await api(endpoint, { method: 'POST', body: { email: parsed.data }, noRefresh: true })
      setSent(true)
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className={s.title}>{title}</h1>
      <p className={s.lead}>{lead}</p>
      <form className={s.form} onSubmit={submit} noValidate>
        <Field label="Почта" error={error}>
          {(a11y) => <Input {...a11y} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
        </Field>
        {sent && (
          <Alert tone="success">
            Если аккаунт с такой почтой есть, письмо уже в пути. Ссылка работает 15 минут и один раз. Демо-письма — в «Почте» внизу справа.
          </Alert>
        )}
        <Button type="submit" variant="primary" block loading={busy}>
          {button}
        </Button>
        <Link to="/login">← Ко входу</Link>
      </form>
    </>
  )
}

export const MagicLinkPage = () => (
  <EmailRequestPage title="Вход по ссылке" lead="Пришлём на почту ссылку для входа — пароль не нужен." endpoint="/auth/magic-link" button="Прислать ссылку" />
)

export const ForgotPasswordPage = () => (
  <EmailRequestPage title="Восстановление пароля" lead="Пришлём ссылку, по которой можно задать новый пароль." endpoint="/auth/password/forgot" button="Прислать ссылку" />
)
