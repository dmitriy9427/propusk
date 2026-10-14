/**
 * Ограничение частоты: не больше N попыток за окно времени на один ключ
 * (почта, адрес). Защищает от рассылки писем на чужую почту и от перебора.
 *
 * Алгоритм — «фиксированное окно»: счётчик попыток и время начала окна.
 * Окно прошло — счётчик обнуляется. Просто и достаточно для одного сервера;
 * для нескольких серверов счётчики хранят в Redis.
 */
import { ApiError } from './http.ts'

export function createRateLimiter(limit: number, windowSec: number, now: () => number) {
  const hits = new Map<string, { count: number; start: number }>()
  return (key: string) => {
    const t = now()
    const entry = hits.get(key)
    if (!entry || t - entry.start > windowSec * 1000) {
      hits.set(key, { count: 1, start: t })
      return
    }
    entry.count++
    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.start + windowSec * 1000 - t) / 1000)
      throw new ApiError(429, 'rate-limited', `Слишком часто. Повторите через ${retryAfter} с`, undefined, retryAfter)
    }
  }
}
