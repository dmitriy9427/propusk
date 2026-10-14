/**
 * Что нужно каждому маршруту: база, часы, адрес сайта. Передаётся в createApp —
 * в тестах подставляем свои часы и узнаём, что будет «через 31 день».
 */
import type { CookieBridge } from './lib/cookies.ts'
import type { Db, Session, User } from './db.ts'

export interface Deps {
  db: Db
  /** Текущее время, мс. В тестах — управляемые часы. */
  now: () => number
  /** Адрес сайта для ссылок в письмах: https://dmitriy9427.github.io/propusk */
  appUrl: string
  /** Домен для passkeys (без порта и пути): localhost, dmitriy9427.github.io */
  rpID: string
  /** Источник, с которого разрешены passkeys: https://dmitriy9427.github.io */
  origin: string
  /** Сколько раз хешировать пароль. В тестах — меньше, чтобы тесты шли быстро. */
  pbkdf2Iterations?: number
}

export interface AppEnv {
  Bindings: CookieBridge
  Variables: {
    deps: Deps
    /** Есть только на маршрутах за requireAuth. */
    user: User
    session: Session
  }
}
