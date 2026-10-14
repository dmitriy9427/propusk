/**
 * Жизненный цикл сессии на клиенте: старт приложения, вход, выход, вкладки.
 */
import { acceptTokens, logout, refreshTokens, type TokenResponse } from './http'
import { getSession, setSession } from './session-store'
import { broadcast, onBroadcast } from './tabs'

export type LoginResult = TokenResponse | { mfaRequired: true; ticket: string }

export const needsMfa = (result: LoginResult): result is { mfaRequired: true; ticket: string } => 'mfaRequired' in result

/** Билет второго шага — между экраном пароля и экраном кода. В памяти: перезагрузили — начните вход заново. */
let mfaTicket: string | null = null
export const setMfaTicket = (ticket: string | null) => {
  mfaTicket = ticket
}
export const getMfaTicket = () => mfaTicket

/** Вход завершён: запомнить токены и сказать другим вкладкам. */
export function completeLogin(tokens: TokenResponse) {
  mfaTicket = null
  acceptTokens(tokens)
  broadcast({ type: 'login' })
}

let started: Promise<void> | null = null

/**
 * Старт приложения: есть ли сессия? Access-токена после перезагрузки нет
 * (он был только в памяти), но есть refresh-cookie — пробуем обновиться.
 * Получилось — человек «остался в системе». Нет — показываем вход.
 */
export function bootstrapSession(): Promise<void> {
  started ??= (async () => {
    if (getSession().status !== 'loading') return
    const ok = await refreshTokens()
    if (!ok && getSession().status === 'loading') setSession({ status: 'anonymous' })
  })()
  return started
}

/**
 * Обновлять access-токен заранее, за минуту до конца срока: тогда запросы не
 * натыкаются на 401. Если вкладка спала (ноутбук закрыли), таймер сработает
 * поздно — не страшно: тогда выручит повтор в api().
 */
let timer: ReturnType<typeof setTimeout> | null = null
export function scheduleRefresh() {
  if (timer) clearTimeout(timer)
  const session = getSession()
  if (session.status !== 'authenticated') return
  const delay = Math.max(5_000, session.expiresAt - Date.now() - 60_000)
  timer = setTimeout(() => void refreshTokens(), delay)
}

/** Подписки на события других вкладок. Вызывается один раз при старте. */
export function listenToOtherTabs() {
  return onBroadcast((message) => {
    if (message.type === 'logout' && getSession().status === 'authenticated') {
      setSession({ status: 'anonymous', reason: 'Вы вышли в другой вкладке' })
    }
    // Вошли в другой вкладке — refresh-cookie уже есть, получаем свой access-токен.
    if (message.type === 'login' && getSession().status !== 'authenticated') void refreshTokens()
  })
}

export { logout }
