/**
 * Связь между вкладками одного сайта.
 *
 * BroadcastChannel — «рация» на все вкладки этого сайта. Вышли в одной —
 * говорим остальным «logout», и они тоже показывают экран входа. Иначе во
 * второй вкладке человек продолжал бы видеть личные данные.
 *
 * Web Locks (navigator.locks) — «очередь к двери». Refresh-токен меняется при
 * каждом обновлении (ротация). Если две вкладки одновременно отправят ОДИН И
 * ТОТ ЖЕ refresh-токен, сервер решит, что его украли, и завершит сессию. Замок
 * гарантирует: обновляет одна вкладка, вторая ждёт и потом идёт уже с новым
 * токеном (cookie общая для всех вкладок).
 */
type Message = { type: 'logout'; reason?: string } | { type: 'login' }

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('propusk-auth') : null

export function broadcast(message: Message) {
  channel?.postMessage(message)
}

export function onBroadcast(handler: (message: Message) => void) {
  const listener = (event: MessageEvent<Message>) => handler(event.data)
  channel?.addEventListener('message', listener)
  return () => channel?.removeEventListener('message', listener)
}

/** Выполнить fn под замком: в любой момент не больше одной вкладки внутри. */
export function withTabLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(name, fn)
  return fn() // очень старый браузер — без замка
}
