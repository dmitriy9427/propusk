/**
 * Профиль: кто вы и насколько защищён аккаунт — чек-лист с прямыми ссылками
 * на то, что стоит включить.
 */
import { CheckCircle2, Circle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { api } from '@/auth/http'
import { Badge, Button, Card, Field, Input } from '@/ui'
import type { PublicUser } from '@server/core.ts'

import s from './account.module.css'
import { useAccountMutation, useMe } from './queries'

export function ProfilePage() {
  const { data: me } = useMe()
  if (!me) return <p>Загружаем…</p>

  const checks = [
    { ok: me.emailVerified, text: 'Почта подтверждена', to: null },
    { ok: me.hasPassword, text: 'Задан пароль', to: '/security' },
    { ok: me.totpEnabled, text: 'Двухфакторная защита включена', to: '/security' },
    { ok: me.passkeys > 0, text: 'Добавлен ключ доступа', to: '/security' },
    // Коды восстановления имеют смысл только при включённой 2FA.
    ...(me.totpEnabled ? [{ ok: me.recoveryCodesLeft >= 3, text: 'Есть запас кодов восстановления', to: '/security' }] : []),
  ]
  const score = checks.filter((c) => c.ok).length

  return (
    <div className={s.page}>
      <h1 className={s.title}>Здравствуйте, {me.name}</h1>
      <div className={s.grid}>
        <Card title="Профиль">
          <dl className={s.facts}>
            <dt>Почта</dt>
            <dd>
              {me.email} {me.emailVerified && <Badge tone="ok">подтверждена</Badge>}
            </dd>
            <dt>Роль</dt>
            <dd>{me.role === 'admin' ? <Badge tone="warn">администратор</Badge> : 'пользователь'}</dd>
            <dt>Вход через</dt>
            <dd>{me.identities.length ? 'Ромашка ID' : '—'}</dd>
            <dt>С нами с</dt>
            <dd>{new Date(me.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
          </dl>
          <NameForm me={me} />
        </Card>
        <Card title={`Защита аккаунта: ${score} из ${checks.length}`}>
          <div className={s.score} style={{ '--score': score / checks.length } as React.CSSProperties} aria-hidden />
          <ul className={s.checks}>
            {checks.map((c) => (
              <li key={c.text} className={c.ok ? s.ok : ''}>
                {c.ok ? <CheckCircle2 aria-hidden /> : <Circle aria-hidden />}
                <span>{c.text}</span>
                {!c.ok && c.to && <Link to={c.to}>Включить</Link>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function NameForm({ me }: { me: PublicUser }) {
  const [name, setName] = useState(me.name)
  const save = useAccountMutation((value: string) => api<PublicUser>('/me', { method: 'PATCH', body: { name: value } }))
  return (
    <form
      className={s.inline}
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(name)
      }}
    >
      <Field label="Имя" error={(save.error as Error | null)?.message}>
        {(a11y) => <Input {...a11y} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
      </Field>
      <Button type="submit" loading={save.isPending} disabled={name === me.name}>
        Сохранить
      </Button>
    </form>
  )
}
