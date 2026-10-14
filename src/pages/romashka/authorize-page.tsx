/**
 * Страница «Ромашка ID» — как будто это чужой сайт id.romashka.example.
 * Своё оформление и «адресная строка» сверху, чтобы было видно: человек ушёл
 * с Пропуска к провайдеру. Здесь он выбирает аккаунт и разрешает доступ.
 *
 * Провайдер проверяет параметры (client_id, redirect_uri, PKCE) сам — на
 * сервере, в /provider/api/authorize. Эта страница только показывает и передаёт.
 */
import { useQuery } from '@tanstack/react-query'
import { Flower2, Lock } from 'lucide-react'
import { useState } from 'react'

import { PROVIDER_API } from '@/auth/config'
import { toApiError } from '@/auth/errors'

import s from './romashka.module.css'

interface Account {
  id: string
  email: string
  name: string
}

async function providerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PROVIDER_API}${path}`, init)
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as T
}

export function RomashkaAuthorizePage() {
  const params = new URLSearchParams(location.search)
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const client = useQuery({ queryKey: ['romashka-client', clientId], queryFn: () => providerFetch<{ name: string }>(`/client/${clientId}`) })
  const accounts = useQuery({ queryKey: ['romashka-accounts'], queryFn: () => providerFetch<Account[]>('/accounts') })
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function allow() {
    setError('')
    try {
      const { redirectTo } = await providerFetch<{ redirectTo: string }>('/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountId: selected,
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: params.get('code_challenge'),
          code_challenge_method: params.get('code_challenge_method'),
          nonce: params.get('nonce'),
          state: params.get('state'),
        }),
      })
      location.href = redirectTo
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function deny() {
    // Отказ — по стандарту возвращаем error=access_denied и тот же state.
    const url = new URL(redirectUri)
    url.searchParams.set('error', 'access_denied')
    url.searchParams.set('state', params.get('state') ?? '')
    location.href = url.toString()
  }

  return (
    <div className={s.page}>
      <div className={s.addressBar}>
        <Lock size={14} aria-hidden /> id.romashka.example/authorize <span className={s.demo}>(демо: на самом деле это тот же сайт)</span>
      </div>
      <main className={s.card}>
        <div className={s.brand}>
          <Flower2 aria-hidden /> Ромашка ID
        </div>
        {client.error ? (
          <p className={s.error}>Приложение «{clientId}» не зарегистрировано у провайдера.</p>
        ) : (
          <>
            <h1 className={s.title}>Войти в «{client.data?.name ?? '…'}»</h1>
            <p className={s.text}>Выберите аккаунт. Приложение получит ваше имя и почту.</p>
            <ul className={s.accounts}>
              {accounts.data?.map((a) => (
                <li key={a.id}>
                  <label className={s.account}>
                    <input type="radio" name="account" checked={selected === a.id} onChange={() => setSelected(a.id)} />
                    <span className={s.avatar} aria-hidden>
                      {a.name[0]}
                    </span>
                    <span>
                      <b>{a.name}</b>
                      <br />
                      <small>{a.email}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className={s.scopes}>
              «{client.data?.name}» получит: <b>имя</b>, <b>адрес почты</b>. Пароль от Ромашки приложение не увидит.
            </p>
            {error && <p className={s.error}>{error}</p>}
            <div className={s.actions}>
              <button type="button" className={s.secondary} onClick={deny}>
                Отказаться
              </button>
              <button type="button" className={s.primary} onClick={allow} disabled={!selected}>
                Разрешить
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
