/**
 * Окно «Подтвердите, что это вы». Открывается само (см. auth/step-up.ts),
 * когда сервер просит заново подтвердить личность перед опасным действием.
 * Способы: пароль, код из приложения, ключ доступа — что есть у человека.
 */
import { Fingerprint } from 'lucide-react'
import { useState } from 'react'

import { ApiError } from '@/auth/errors'
import { api } from '@/auth/http'
import { passkeyError, stepUpWithPasskey } from '@/auth/passkey'
import { useUser } from '@/auth/session-store'
import { cancelStepUp, confirmStepUp, useStepUpOpen } from '@/auth/step-up'
import { Alert, Button, Field, Input } from '@/ui'
import { Dialog } from '@/ui/dialog'

export function StepUpDialog() {
  const open = useStepUpOpen()
  return (
    <Dialog open={open} onClose={cancelStepUp} title="Подтвердите, что это вы">
      {open && <StepUpForm />}
    </Dialog>
  )
}

function StepUpForm() {
  const user = useUser()
  const [mode, setMode] = useState<'password' | 'code'>(user?.hasPassword ? 'password' : 'code')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/me/step-up', { method: 'POST', body: mode === 'password' ? { password: value } : { code: value } })
      confirmStepUp()
    } catch (e) {
      setError(Object.values((e as ApiError).fields ?? {})[0] ?? (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function withPasskey() {
    setError('')
    try {
      await stepUpWithPasskey()
      confirmStepUp()
    } catch (e) {
      setError(passkeyError(e))
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }} noValidate>
      <Alert tone="info">Это защита важных настроек: даже с открытой сессией их нельзя поменять, не подтвердив личность. Подтверждение действует 5 минут.</Alert>
      {mode === 'password' ? (
        <Field label="Пароль" error={error}>
          {(a11y) => <Input {...a11y} type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="current-password" data-autofocus />}
        </Field>
      ) : (
        <Field label="Код из приложения" error={error}>
          {(a11y) => (
            <Input {...a11y} value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" data-autofocus />
          )}
        </Field>
      )}
      <Button type="submit" variant="primary" loading={busy} block>
        Подтвердить
      </Button>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
        {user?.hasPassword && user.totpEnabled && (
          <button type="button" className="link-button" onClick={() => setMode(mode === 'password' ? 'code' : 'password')}>
            {mode === 'password' ? 'Кодом из приложения' : 'Паролем'}
          </button>
        )}
        {user && user.passkeys > 0 && (
          <Button variant="ghost" icon={<Fingerprint />} onClick={withPasskey}>
            Ключом доступа
          </Button>
        )}
      </div>
    </form>
  )
}
