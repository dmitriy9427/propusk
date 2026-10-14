/**
 * Регистрация. После неё — письмо со ссылкой; войти можно, только подтвердив
 * почту. Правила полей — те же, что на сервере (shared/schemas.ts).
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import type { z } from 'zod'

import { isApiError } from '@/auth/errors'
import { api } from '@/auth/http'
import { Alert, Button, Field, Input } from '@/ui'
import { registerSchema } from '@shared/schemas.ts'

import s from './auth.module.css'
import { PasswordMeter } from './password-meter'

type Values = z.infer<typeof registerSchema>

export function RegisterPage() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(registerSchema), mode: 'onTouched', defaultValues: { email: '', name: '', password: '' } })
  const password = useWatch({ control, name: 'password' })

  async function onSubmit(values: Values) {
    setFailure('')
    try {
      await api('/auth/register', { method: 'POST', body: values, noRefresh: true })
      setSentTo(values.email)
    } catch (error) {
      if (isApiError(error, 'invalid')) Object.entries(error.fields).forEach(([k, m]) => setError(k as keyof Values, { message: m }))
      else setFailure((error as Error).message)
    }
  }

  if (sentTo) {
    return (
      <>
        <MailCheck size={40} color="var(--accent)" aria-hidden />
        <h1 className={s.title}>Проверьте почту</h1>
        <p className={s.lead}>
          Мы отправили ссылку на <b>{sentTo}</b>. Перейдите по ней, чтобы подтвердить почту и войти.
        </p>
        <div className={s.form}>
          <Alert tone="info">
            Это демо: письма приходят во встроенную почту — кнопка «Почта» внизу справа. Если такая почта уже была
            зарегистрирована, придёт другое письмо — сервер не раскрывает, кто у него есть.
          </Alert>
          <Link to="/login">← Ко входу</Link>
        </div>
      </>
    )
  }

  return (
    <>
      <h1 className={s.title}>Регистрация</h1>
      <p className={s.lead}>
        Уже есть аккаунт? <Link to="/login">Войдите</Link>
      </p>
      <form className={s.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field label="Как к вам обращаться" error={errors.name?.message}>
          {(a11y) => <Input {...a11y} {...register('name')} autoComplete="name" />}
        </Field>
        <Field label="Почта" error={errors.email?.message}>
          {(a11y) => <Input {...a11y} {...register('email')} type="email" autoComplete="email" inputMode="email" />}
        </Field>
        <Field label="Пароль" error={errors.password?.message} hint={<PasswordMeter value={password} />}>
          {/* new-password — менеджер паролей предложит сгенерировать надёжный. */}
          {(a11y) => <Input {...a11y} {...register('password')} type="password" autoComplete="new-password" />}
        </Field>
        {failure && <Alert tone="danger">{failure}</Alert>}
        <Button type="submit" variant="primary" block loading={isSubmitting}>
          Создать аккаунт
        </Button>
      </form>
    </>
  )
}
