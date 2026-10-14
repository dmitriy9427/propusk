/**
 * Passkeys (WebAuthn) — вход без пароля по ключу, который хранит устройство:
 * Touch ID, Face ID, Windows Hello, телефон или USB-ключ.
 *
 * Идея — криптография с открытым ключом:
 *   регистрация: устройство создаёт ПАРУ ключей. Закрытый остаётся в устройстве
 *     и никогда его не покидает, открытый отправляется нам и хранится в базе;
 *   вход: мы присылаем случайный «вызов» (challenge), устройство подписывает его
 *     закрытым ключом (после отпечатка или PIN), мы проверяем подпись открытым.
 *
 * Украсть с сервера нечего: открытый ключ бесполезен для входа. Фишинг тоже не
 * сработает: браузер привязывает ключ к домену (rpID) и на поддельный сайт его
 * не отдаст.
 *
 * Тяжёлую часть (разбор CBOR, проверку подписи и атрибутов) делает
 * @simplewebauthn/server — писать её самим — верный путь к уязвимости.
 */
import {
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'

import { CONFIG } from '../config.ts'
import type { Deps } from '../context.ts'
import type { Passkey, User } from '../db.ts'
import { fromBase64Url, randomToken, toBase64Url } from './crypto.ts'
import { ApiError } from './http.ts'

const CHALLENGE_TTL = 5 * 60 * 1000

/** Вызов хранится на сервере под случайным ключом; ключ отдаём клиенту. */
function saveChallenge(deps: Deps, value: string, userId: string | null) {
  const key = randomToken(16)
  const now = deps.now()
  deps.db.data.challenges = deps.db.data.challenges.filter((c) => c.expiresAt > now)
  deps.db.data.challenges.push({ key, value, userId, expiresAt: now + CHALLENGE_TTL })
  deps.db.changed()
  return key
}

function takeChallenge(deps: Deps, key: string) {
  const list = deps.db.data.challenges
  const index = list.findIndex((c) => c.key === key && c.expiresAt > deps.now())
  if (index < 0) throw new ApiError(400, 'challenge-expired', 'Время на подтверждение вышло — попробуйте ещё раз')
  const [challenge] = list.splice(index, 1) // одноразовый
  deps.db.changed()
  return challenge!
}

export async function registrationOptions(deps: Deps, user: User) {
  const existing = deps.db.data.passkeys.filter((p) => p.userId === user.id)
  const options = await generateRegistrationOptions({
    rpName: CONFIG.rpName,
    rpID: deps.rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    // Не дать зарегистрировать тот же ключ второй раз.
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
    // residentKey: 'required' — ключ «помнит» пользователя: войти можно, не вводя почту.
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })
  return { options, challengeId: saveChallenge(deps, options.challenge, user.id) }
}

export async function verifyRegistration(deps: Deps, user: User, challengeId: string, response: RegistrationResponseJSON, name: string) {
  const challenge = takeChallenge(deps, challengeId)
  if (challenge.userId !== user.id) throw new ApiError(400, 'challenge-mismatch', 'Вызов выдан другому пользователю')
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.value,
    expectedOrigin: deps.origin,
    expectedRPID: deps.rpID,
    requireUserVerification: false,
  }).catch((error: Error) => {
    throw new ApiError(400, 'passkey-invalid', `Ключ не прошёл проверку: ${error.message}`)
  })
  if (!result.verified) throw new ApiError(400, 'passkey-invalid', 'Ключ не прошёл проверку')
  const { credential } = result.registrationInfo
  const passkey: Passkey = {
    id: credential.id,
    userId: user.id,
    publicKey: toBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    name: name || 'Ключ доступа',
    createdAt: deps.now(),
    lastUsedAt: null,
  }
  deps.db.data.passkeys.push(passkey)
  deps.db.changed()
  return passkey
}

/** Вход без почты: allowCredentials пустой — браузер сам предложит сохранённые ключи этого сайта. */
export async function authenticationOptions(deps: Deps) {
  const options = await generateAuthenticationOptions({ rpID: deps.rpID, userVerification: 'preferred' })
  return { options, challengeId: saveChallenge(deps, options.challenge, null) }
}

export async function verifyAuthentication(deps: Deps, challengeId: string, response: AuthenticationResponseJSON) {
  const challenge = takeChallenge(deps, challengeId)
  const passkey = deps.db.data.passkeys.find((p) => p.id === response.id)
  if (!passkey) throw new ApiError(400, 'passkey-unknown', 'Этот ключ здесь не зарегистрирован')
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.value,
    expectedOrigin: deps.origin,
    expectedRPID: deps.rpID,
    credential: { id: passkey.id, publicKey: fromBase64Url(passkey.publicKey), counter: passkey.counter, transports: passkey.transports },
    requireUserVerification: false,
  }).catch((error: Error) => {
    throw new ApiError(400, 'passkey-invalid', `Подпись не прошла проверку: ${error.message}`)
  })
  if (!result.verified) throw new ApiError(400, 'passkey-invalid', 'Подпись не прошла проверку')
  // Счётчик использований: если пришёл меньше сохранённого — ключ скопировали.
  passkey.counter = result.authenticationInfo.newCounter
  passkey.lastUsedAt = deps.now()
  deps.db.changed()
  return passkey
}
