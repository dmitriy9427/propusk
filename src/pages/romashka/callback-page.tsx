/**
 * /auth/romashka — сюда «Ромашка ID» возвращает человека с ?code=…&state=….
 * Сверяем state, отдаём код и code_verifier нашему серверу — он сам обменяет
 * код на токены у провайдера и проверит id_token.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { api } from '@/auth/http'
import { finishRomashkaLogin } from '@/auth/romashka'
import { type LoginResult, completeLogin, needsMfa, setMfaTicket } from '@/auth/session'
import { Alert } from '@/ui'

export function RomashkaCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return // код одноразовый — не отправлять дважды в StrictMode
    started.current = true
    const search = new URLSearchParams(location.search)
    history.replaceState(null, '', location.pathname) // код не должен остаться в истории
    ;(async () => {
      const { code, codeVerifier, nonce, next } = finishRomashkaLogin(search)
      const result = await api<LoginResult>('/auth/oauth/romashka', { method: 'POST', body: { code, codeVerifier, nonce }, noRefresh: true })
      if (needsMfa(result)) {
        setMfaTicket(result.ticket)
        navigate(`/login/mfa?next=${encodeURIComponent(next)}`, { replace: true })
      } else {
        completeLogin(result)
        navigate(next, { replace: true })
      }
    })().catch((e: Error) => setError(e.message))
  }, [navigate])

  if (!error) return <p>Завершаем вход через Ромашка ID…</p>
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Alert tone="danger">{error}</Alert>
      <Link to="/login">← Ко входу</Link>
    </div>
  )
}
