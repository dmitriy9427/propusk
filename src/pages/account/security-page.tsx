/**
 * Безопасность: пароль, двухфакторная защита, коды восстановления, ключи
 * доступа. Опасные действия сервер пропускает только в «режиме судо» — если
 * его нет, api() сам покажет окно подтверждения и повторит запрос.
 */
import { Copy, Download, Fingerprint, KeyRound, Smartphone, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { renderSVG } from 'uqr'

import { isApiError } from '@/auth/errors'
import { api } from '@/auth/http'
import { passkeyError, passkeysSupported, registerPasskey } from '@/auth/passkey'
import { PasswordMeter } from '@/pages/auth/password-meter'
import { Alert, Badge, Button, Card, Field, Input } from '@/ui'
import type { PublicUser } from '@server/core.ts'
import { passwordSchema } from '@shared/schemas.ts'

import s from './account.module.css'
import { formatAgo } from './format'
import { useAccountMutation, useMe, usePasskeys } from './queries'

export function SecurityPage() {
  const { data: me } = useMe()
  if (!me) return <p>Загружаем…</p>
  return (
    <div className={s.page}>
      <h1 className={s.title}>Безопасность</h1>
      <p className={s.lead}>Важные настройки защищены повторным подтверждением: окно появится само, если с последнего входа прошло больше 5 минут.</p>
      <div className={s.grid}>
        <PasswordCard me={me} />
        <TotpCard me={me} />
        <PasskeysCard />
      </div>
    </div>
  )
}

// ─── Пароль ───────────────────────────────────────────────────────────────────

function PasswordCard({ me }: { me: PublicUser }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const save = useAccountMutation((value: string) => api<PublicUser>('/me/password', { method: 'POST', body: { password: value } }))

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setDone(false)
    const parsed = passwordSchema.safeParse(password)
    if (!parsed.success) return setError(parsed.error.issues[0]!.message)
    setError('')
    save.mutate(password, {
      onSuccess: () => {
        setPassword('')
        setDone(true)
      },
      onError: (e) => setError(isApiError(e) ? (Object.values(e.fields)[0] ?? e.message) : e.message),
    })
  }

  return (
    <Card title={<span className={s.row}><KeyRound size={18} aria-hidden /> {me.hasPassword ? 'Пароль' : 'Задать пароль'}</span>}>
      {!me.hasPassword && <Alert tone="info">Вы вошли через Ромашка ID. Задайте пароль, чтобы входить и без неё.</Alert>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }} noValidate>
        <Field label="Новый пароль" error={error} hint={<PasswordMeter value={password} />}>
          {(a11y) => <Input {...a11y} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
        </Field>
        {done && <Alert tone="success">Пароль сохранён. Остальные устройства вышли из аккаунта.</Alert>}
        <Button type="submit" variant="primary" loading={save.isPending}>
          {me.hasPassword ? 'Сменить пароль' : 'Задать пароль'}
        </Button>
      </form>
    </Card>
  )
}

// ─── Двухфакторная защита ────────────────────────────────────────────────────

type TotpStep = { kind: 'idle' } | { kind: 'scan'; secret: string; url: string } | { kind: 'codes'; codes: string[] }

function TotpCard({ me }: { me: PublicUser }) {
  const [step, setStep] = useState<TotpStep>({ kind: 'idle' })
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const setup = useAccountMutation(() => api<{ secret: string; otpauthUrl: string }>('/me/totp/setup', { method: 'POST' }))
  const enable = useAccountMutation((value: string) => api<{ recoveryCodes: string[] }>('/me/totp/enable', { method: 'POST', body: { code: value } }))
  const disable = useAccountMutation(() => api('/me/totp/disable', { method: 'POST' }))
  const regenerate = useAccountMutation(() => api<{ recoveryCodes: string[] }>('/me/recovery-codes', { method: 'POST' }))

  const fail = (e: Error) => setError(isApiError(e) ? (Object.values(e.fields)[0] ?? e.message) : e.message)

  const title = (
    <span className={s.row}>
      <Smartphone size={18} aria-hidden /> Двухфакторная защита {me.totpEnabled ? <Badge tone="ok">включена</Badge> : <Badge tone="warn">выключена</Badge>}
    </span>
  )

  if (step.kind === 'codes') {
    return (
      <Card title="Сохраните коды восстановления">
        <Alert tone="warning">
          Если потеряете телефон, войти можно будет только с одним из этих кодов. Каждый работает один раз. Больше мы их не покажем — сохраните в менеджер паролей или распечатайте.
        </Alert>
        <ul className={s.codes}>
          {step.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className={s.row}>
          <Button icon={<Copy />} onClick={() => void navigator.clipboard.writeText(step.codes.join('\n'))}>
            Скопировать
          </Button>
          <Button icon={<Download />} onClick={() => downloadCodes(step.codes)}>
            Скачать .txt
          </Button>
          <Button variant="primary" onClick={() => setStep({ kind: 'idle' })}>
            Я сохранил
          </Button>
        </div>
      </Card>
    )
  }

  if (step.kind === 'scan') {
    return (
      <Card title="Включение двухфакторной защиты">
        <ol style={{ display: 'grid', gap: 8, paddingLeft: 20 }}>
          <li>Откройте приложение-аутентификатор (Google Authenticator, Яндекс Ключ, 1Password, Bitwarden).</li>
          <li>Отсканируйте QR-код или введите ключ вручную.</li>
          <li>Введите 6 цифр, которые покажет приложение.</li>
        </ol>
        {/* QR рисуем сами из ссылки otpauth:// — секрет не уходит ни в какой сторонний сервис. */}
        <div className={s.qr} dangerouslySetInnerHTML={{ __html: renderSVG(step.url) }} aria-label="QR-код для приложения-аутентификатора" role="img" />
        <p className={s.muted}>
          Ключ вручную: <span className={s.secret}>{step.secret.match(/.{1,4}/g)?.join(' ')}</span>
        </p>
        <form
          style={{ display: 'grid', gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault()
            setError('')
            enable.mutate(code, { onSuccess: (r) => setStep({ kind: 'codes', codes: r.recoveryCodes }), onError: fail })
          }}
          noValidate
        >
          <Field label="Код из приложения" error={error}>
            {(a11y) => (
              <Input {...a11y} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" />
            )}
          </Field>
          <div className={s.row}>
            <Button onClick={() => setStep({ kind: 'idle' })}>Отмена</Button>
            <Button type="submit" variant="primary" loading={enable.isPending} disabled={code.length !== 6}>
              Включить
            </Button>
          </div>
        </form>
      </Card>
    )
  }

  return (
    <Card title={title}>
      <p className={s.muted}>
        После пароля сервер попросит 6 цифр из приложения на телефоне. Украденный пароль без телефона бесполезен.
      </p>
      {me.totpEnabled ? (
        <>
          <p>
            Кодов восстановления осталось: <b>{me.recoveryCodesLeft}</b> {me.recoveryCodesLeft < 3 && <Badge tone="warn">мало</Badge>}
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className={s.row}>
            <Button loading={regenerate.isPending} onClick={() => regenerate.mutate(undefined, { onSuccess: (r) => setStep({ kind: 'codes', codes: r.recoveryCodes }), onError: fail })}>
              Новые коды восстановления
            </Button>
            <Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate(undefined, { onError: fail })}>
              Выключить
            </Button>
          </div>
        </>
      ) : (
        <>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button
            variant="primary"
            loading={setup.isPending}
            onClick={() => {
              setError('')
              setCode('')
              setup.mutate(undefined, { onSuccess: (r) => setStep({ kind: 'scan', secret: r.secret, url: r.otpauthUrl }), onError: fail })
            }}
          >
            Включить
          </Button>
        </>
      )}
    </Card>
  )
}

function downloadCodes(codes: string[]) {
  const blob = new Blob([`Коды восстановления Пропуска\n\n${codes.join('\n')}\n\nКаждый код работает один раз.`], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'propusk-recovery-codes.txt'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ─── Ключи доступа ───────────────────────────────────────────────────────────

function PasskeysCard() {
  const { data: passkeys = [] } = usePasskeys()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const add = useAccountMutation((value: string) => registerPasskey(value))
  const remove = useAccountMutation((id: string) => api(`/me/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }))

  return (
    <Card title={<span className={s.row}><Fingerprint size={18} aria-hidden /> Ключи доступа</span>}>
      <p className={s.muted}>
        Вход отпечатком, лицом или PIN-кодом устройства — без пароля. Ключ хранится в устройстве; серверу достаётся только открытая часть, украсть с сервера нечего.
      </p>
      {!passkeysSupported() && <Alert tone="warning">Этот браузер не поддерживает ключи доступа.</Alert>}
      <ul className={s.list}>
        {passkeys.map((p) => (
          <li key={p.id}>
            <div className={s.grow}>
              <b>{p.name}</b>
              <span className={s.muted}>
                Добавлен {formatAgo(p.createdAt)} · {p.lastUsedAt ? `вход ${formatAgo(p.lastUsedAt)}` : 'ещё не использовался'}
              </span>
            </div>
            <Button variant="ghost" icon={<Trash2 />} aria-label={`Удалить ключ «${p.name}»`} onClick={() => remove.mutate(p.id, { onError: (e) => setError(e.message) })} />
          </li>
        ))}
      </ul>
      <form
        className={s.inline}
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          add.mutate(name || 'Ключ доступа', { onSuccess: () => setName(''), onError: (e) => setError(passkeyError(e)) })
        }}
      >
        <Field label="Название ключа">
          {(a11y) => <Input {...a11y} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Например, MacBook" />}
        </Field>
        <Button type="submit" loading={add.isPending} disabled={!passkeysSupported()}>
          Добавить
        </Button>
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
    </Card>
  )
}
