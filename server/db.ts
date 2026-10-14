/**
 * «База данных» сервера — объект в памяти. В Node он сохраняется в файл,
 * в браузерном демо — в localStorage (см. server/index.ts и src/mocks).
 *
 * Главное правило безопасности, которое видно по типам ниже: секреты НЕ
 * хранятся в открытом виде. Вместо пароля — хеш PBKDF2, вместо refresh-токена
 * и ссылок из писем — их SHA-256. Утечёт база — по ней нельзя войти.
 */
export type Role = 'user' | 'admin'

export interface User {
  id: string
  email: string
  name: string
  emailVerified: boolean
  /** null — вошёл только через «Ромашка ID» и пароль не задавал. */
  passwordHash: string | null
  role: Role
  blocked: boolean
  createdAt: number
  /** Двухфакторная защита (TOTP). */
  totp: { secret: string; enabledAt: number; lastCounter: number } | null
  /** Секрет, который показали QR-кодом, но ещё не подтвердили кодом. */
  pendingTotpSecret: string | null
  /** Хеши неиспользованных кодов восстановления. */
  recoveryCodes: string[]
  /** Защита от подбора пароля. */
  failedLogins: number
  lockedUntil: number
  /** Внешние входы: «Ромашка ID» → id пользователя там. */
  identities: { provider: 'romashka'; subject: string }[]
}

/**
 * Сессия = одно устройство. Внутри живёт цепочка refresh-токенов: при каждом
 * обновлении выдаётся новый, а старый запоминается как использованный.
 * Если кто-то предъявит СТАРЫЙ токен — его украли: отзываем всю сессию.
 */
export interface Session {
  id: string
  userId: string
  createdAt: number
  lastUsedAt: number
  expiresAt: number
  userAgent: string
  /** Хеш действующего refresh-токена. */
  tokenHash: string
  /** Хеши уже использованных (заменённых) токенов этой сессии. */
  usedHashes: string[]
  /** Каким способом вошли: пароль, пароль+2FA, ссылка, passkey, Ромашка ID. */
  method: 'password' | 'password+totp' | 'magic-link' | 'passkey' | 'romashka'
  /** Когда последний раз подтверждали личность (для «режима судо»). */
  stepUpAt: number
  revokedAt: number | null
  revokeReason: string | null
}

export type EmailPurpose = 'verify' | 'magic' | 'reset'

export interface EmailToken {
  hash: string
  purpose: EmailPurpose
  userId: string
  expiresAt: number
  usedAt: number | null
}

/** Письмо в демо-почтовом ящике (настоящей почты у демо нет). */
export interface Mail {
  id: string
  to: string
  subject: string
  text: string
  link: string
  createdAt: number
}

export type AuditType =
  | 'register'
  | 'email-verified'
  | 'login'
  | 'login-failed'
  | 'locked'
  | 'logout'
  | 'session-revoked'
  | 'refresh-reuse'
  | 'password-changed'
  | 'password-reset'
  | 'totp-enabled'
  | 'totp-disabled'
  | 'recovery-used'
  | 'passkey-added'
  | 'passkey-removed'
  | 'identity-linked'
  | 'role-changed'
  | 'blocked'
  | 'unblocked'

export interface AuditEvent {
  id: string
  userId: string
  type: AuditType
  at: number
  userAgent: string
  details: string
}

export interface Passkey {
  /** id ключа (credentialID), base64url. */
  id: string
  userId: string
  publicKey: string
  counter: number
  transports: string[]
  name: string
  createdAt: number
  lastUsedAt: number | null
}

/** Одноразовые «вызовы» WebAuthn и билеты второго шага входа. */
export interface Challenge {
  key: string
  value: string
  userId: string | null
  expiresAt: number
}

export interface MfaTicket {
  hash: string
  userId: string
  /** Чем прошли первый шаг: паролем или ссылкой из письма. */
  method: 'password' | 'magic-link' | 'romashka'
  userAgent: string
  expiresAt: number
}

/** Данные демо-провайдера «Ромашка ID» — это как бы чужой сервис. */
export interface ProviderUser {
  id: string
  email: string
  name: string
}

export interface ProviderCode {
  hash: string
  providerUserId: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  nonce: string
  expiresAt: number
}

export interface Data {
  version: 1
  /** Ключ подписи access-токенов (HMAC). Знает только сервер. */
  jwtSecret: string
  users: User[]
  sessions: Session[]
  emailTokens: EmailToken[]
  mails: Mail[]
  audit: AuditEvent[]
  passkeys: Passkey[]
  challenges: Challenge[]
  mfaTickets: MfaTicket[]
  provider: {
    users: ProviderUser[]
    codes: ProviderCode[]
    /** Ключи подписи id_token провайдера (ES256): закрытый — у провайдера, открытый — в JWKS. */
    privateJwk: JsonWebKey | null
    publicJwk: JsonWebKey | null
  }
}

export function emptyData(): Data {
  return {
    version: 1,
    jwtSecret: '',
    users: [],
    sessions: [],
    emailTokens: [],
    mails: [],
    audit: [],
    passkeys: [],
    challenges: [],
    mfaTickets: [],
    provider: { users: [], codes: [], privateJwk: null, publicJwk: null },
  }
}

export interface Db {
  data: Data
  /** Сообщить хранилищу, что данные изменились (сохранить в файл или localStorage). */
  changed(): void
}
