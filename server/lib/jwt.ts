/**
 * Access-токен — JWT (JSON Web Token): три части через точку,
 *   заголовок.данные.подпись
 * Данные (payload) — обычный JSON в base64url, его может прочитать кто угодно
 * (вставьте токен на jwt.io). Защищает подпись: её может сделать только тот, у
 * кого есть секрет. Поменяли в данных role: 'admin' — подпись не сойдётся.
 *
 * Поэтому в JWT нельзя класть секреты, а проверять его — обязательно.
 */
import { SignJWT, jwtVerify } from 'jose'

import { CONFIG } from '../config.ts'
import type { Role, Session } from '../db.ts'
import { fromBase64Url } from './crypto.ts'

export interface AccessClaims {
  /** subject — id пользователя. */
  sub: string
  /** id сессии: по нему сервер проверит, что сессию не отозвали. */
  sid: string
  role: Role
  /** authentication methods — как вошли: ['pwd', 'otp'], ['hwk'] (passkey)… */
  amr: string[]
}

const ISSUER = 'propusk'
const AMR: Record<Session['method'], string[]> = {
  password: ['pwd'],
  'password+totp': ['pwd', 'otp'],
  'magic-link': ['email'],
  passkey: ['hwk', 'user'],
  romashka: ['fed'],
}

const key = (secret: string) => fromBase64Url(secret)

export function signAccessToken(secret: string, claims: Omit<AccessClaims, 'amr'> & { method: Session['method'] }, now: number) {
  return new SignJWT({ sid: claims.sid, role: claims.role, amr: AMR[claims.method] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + CONFIG.accessTtlSec)
    .sign(key(secret))
}

/** Проверить подпись, срок и издателя. Ошибка — исключение. */
export async function verifyAccessToken(secret: string, token: string, now: number): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: ISSUER,
    algorithms: ['HS256'], // не доверяем alg из заголовка токена — классическая атака «alg: none»
    currentDate: new Date(now),
  })
  return payload as unknown as AccessClaims
}
