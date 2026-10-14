/**
 * «Под капотом» — лаборатория: увидеть токен, сломать его, украсть refresh-токен
 * и посмотреть, как защита срабатывает по шагам.
 */
import { useEffect, useState } from 'react'

import { API } from '@/auth/config'
import { type ApiEvent, api, onApiEvent, refreshTokens } from '@/auth/http'
import { corruptAccessToken, useSession } from '@/auth/session-store'
import { Alert, Button, Card } from '@/ui'

import s from './account.module.css'
import h from './under-the-hood.module.css'

const REAL = import.meta.env.VITE_REAL_SERVER

/** Разобрать JWT: две первые части — base64url JSON, третья — подпись. */
function decode(part: string) {
  try {
    const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  } catch {
    return null
  }
}

export function UnderTheHoodPage() {
  const session = useSession()
  const [log, setLog] = useState<(ApiEvent & { at: number })[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => onApiEvent((event) => setLog((list) => [{ ...event, at: Date.now() }, ...list].slice(0, 30))), [])
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (session.status !== 'authenticated') return null
  const [header = '', payload = '', signature = ''] = session.accessToken.split('.')
  const claims = decode(payload)
  const left = Math.max(0, Math.round((session.expiresAt - now) / 1000))

  return (
    <div className={s.page}>
      <h1 className={s.title}>Под капотом</h1>
      <p className={s.lead}>Лаборатория: как устроены токены и что происходит, когда что-то идёт не так.</p>

      <Card title="Access-токен (JWT) — живёт в памяти вкладки">
        <p className={h.token}>
          <span className={h.header}>{header}</span>.<span className={h.payload}>{payload}</span>.<span className={h.signature}>{signature}</span>
        </p>
        <div className={h.parts}>
          <div>
            <b className={h.headerText}>Заголовок</b>
            <pre>{JSON.stringify(decode(header), null, 2)}</pre>
          </div>
          <div>
            <b className={h.payloadText}>Данные (их видит кто угодно!)</b>
            <pre>{JSON.stringify(claims, null, 2)}</pre>
          </div>
          <div>
            <b className={h.signatureText}>Подпись</b>
            <p className={s.muted}>HMAC-SHA256 от первых двух частей с секретом сервера. Поменяйте хоть букву в данных — подпись не сойдётся.</p>
          </div>
        </div>
        <p>
          Истекает через <b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>. Клиент обновит его сам за минуту до конца.
        </p>
      </Card>

      <div className={s.grid}>
        <Card title="Опыт 1. Токен испортился">
          <p className={s.muted}>
            Испортим подпись и сделаем запрос. Сервер ответит 401 token-expired, api() обновит токен по refresh-cookie и повторит запрос. Компонент ничего не заметит.
          </p>
          <div className={s.row}>
            <Button onClick={corruptAccessToken}>Испортить токен</Button>
            <Button variant="primary" onClick={() => void api('/me')}>
              Запросить /me
            </Button>
          </div>
          <p className={s.muted}>
            Теперь испортите и нажмите «5 запросов разом»: обновление будет одно, остальные подождут его (single flight).
          </p>
          <Button onClick={() => void Promise.all(['/me', '/me/sessions', '/me/passkeys', '/me/activity', '/me'].map((p) => api(p)))}>5 запросов разом</Button>
        </Card>

        <TheftLab />
      </div>

      <Card title="Журнал запросов" action={<Button variant="ghost" onClick={() => setLog([])}>Очистить</Button>}>
        {log.length === 0 ? (
          <p className={s.muted}>Здесь появятся запросы, ответы, обновления токена и повторы.</p>
        ) : (
          <ol className={h.log}>
            {log.map((e, i) => (
              <li key={i} data-kind={e.kind} data-bad={(e.kind === 'response' && e.status >= 400) || (e.kind === 'refresh' && !e.ok)}>
                <time>{new Date(e.at).toLocaleTimeString('ru-RU')}</time> {describe(e)}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Опыт 3. Вкладки">
        <p className={s.muted}>
          Откройте сайт во второй вкладке и нажмите «Выйти» в одной из них — вторая сразу покажет вход (BroadcastChannel). Обновлять токен вкладки будут по
          очереди (Web Locks): иначе две вкладки отправили бы один и тот же refresh-токен, и сервер принял бы это за кражу.
        </p>
        <Button onClick={() => window.open(location.href, '_blank')}>Открыть вторую вкладку</Button>
      </Card>
    </div>
  )
}

function describe(e: ApiEvent) {
  switch (e.kind) {
    case 'request':
      return `→ ${e.method} ${e.path}`
    case 'response':
      return `← ${e.status} ${e.path}${e.code ? ` (${e.code})` : ''}`
    case 'refresh':
      return e.ok ? '⟳ POST /auth/refresh — новая пара токенов, старый refresh помечен использованным' : `⟳ refresh не удался (${e.code})`
    case 'retry':
      return `↻ повтор ${e.path} — ${e.why}`
  }
}

/**
 * Опыт 2. Кража refresh-токена. Только в демо: здесь «HttpOnly» изображается
 * (cookie хранит MSW в localStorage), поэтому её можно прочитать и подсунуть
 * «вору». С настоящим сервером JavaScript её не увидит — в этом весь смысл HttpOnly.
 */
function TheftLab() {
  const [stolen, setStolen] = useState('')
  const [thiefResult, setThiefResult] = useState('')

  if (REAL) {
    return (
      <Card title="Опыт 2. Кража refresh-токена">
        <Alert tone="info">С настоящим сервером этот опыт не провести: refresh-cookie с флагом HttpOnly недоступна JavaScript. Запустите демо-режим (npm run dev).</Alert>
      </Card>
    )
  }

  function steal() {
    const store = JSON.parse(localStorage.getItem('__msw-cookie-store__') ?? '[]') as { key: string; value: string }[]
    setStolen(store.find((c) => c.key === 'propusk_rt')?.value ?? '')
    setThiefResult('')
  }

  async function thiefRefresh() {
    const res = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { 'x-propusk': '1', 'x-demo-cookie': `propusk_rt=${stolen}` } })
    setThiefResult(res.ok ? 'Вор получил новый access-токен и новый refresh-токен. Ваш refresh-токен теперь считается использованным.' : `Сервер отказал вору: ${res.status}`)
  }

  return (
    <Card title="Опыт 2. Кража refresh-токена">
      <ol style={{ display: 'grid', gap: 10, paddingLeft: 20 }}>
        <li>
          <Button onClick={steal}>Украсть cookie</Button> {stolen && <code className={s.mono}>{stolen.slice(0, 16)}…</code>}
        </li>
        <li>
          <Button onClick={thiefRefresh} disabled={!stolen}>
            Вор обновляет токен
          </Button>
          {thiefResult && <p className={s.muted}>{thiefResult}</p>}
        </li>
        <li>
          <Button variant="primary" onClick={() => void refreshTokens()} disabled={!thiefResult}>
            Вы обновляете токен
          </Button>
          <p className={s.muted}>Сервер увидит уже использованный токен → «кто-то из двоих — вор» → завершит сессию для обоих. Вы окажетесь на входе, а вор — без доступа.</p>
        </li>
      </ol>
    </Card>
  )
}
