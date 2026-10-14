// @vitest-environment node
/**
 * Сценарии входа целиком: от регистрации до кражи refresh-токена.
 * Каждый тест — история, которую можно прочитать как текст.
 */
import { describe, expect, it } from 'vitest'

import { CONFIG } from './config.ts'
import { setup } from './test-utils.ts'

const MIN = 60_000

describe('регистрация и подтверждение почты', () => {
  it('регистрация → письмо → подтверждение → вход', async () => {
    const t = await setup()
    const b = t.browser()
    expect((await b.post('/api/auth/register', { email: 'Kate@Mail.test', name: 'Катя', password: 'длинный пароль 42' })).status).toBe(201)

    // До подтверждения — вход запрещён, но с понятной причиной.
    const early = await b.post('/api/auth/login', { email: 'kate@mail.test', password: 'длинный пароль 42' })
    expect(early.body.code).toBe('email-not-verified')

    const mail = t.lastMail('kate@mail.test')!
    expect(mail.subject).toBe('Подтвердите почту')
    expect((await b.post('/api/auth/verify-email', { token: t.tokenFrom(mail.link) })).status).toBe(200)
    // Ссылка одноразовая.
    expect((await b.post('/api/auth/verify-email', { token: t.tokenFrom(mail.link) })).body.code).toBe('link-invalid')

    const login = await b.post('/api/auth/login', { email: 'kate@mail.test', password: 'длинный пароль 42' })
    expect(login.status).toBe(200)
    expect(login.body.user.email).toBe('kate@mail.test')
    expect((await b.get('/api/me')).body.name).toBe('Катя')
  })

  it('занятая почта: тот же ответ 201 (не раскрываем, кто зарегистрирован), владельцу — письмо', async () => {
    const t = await setup()
    const r = await t.browser().post('/api/auth/register', { email: 'anna@propusk.dev', name: 'Кто-то', password: 'другой пароль 77' })
    expect(r.status).toBe(201)
    expect(t.lastMail('anna@propusk.dev')!.subject).toBe('Попытка регистрации')
  })

  it('слабый пароль отклоняется с ошибкой по полю', async () => {
    const t = await setup()
    const r = await t.browser().post('/api/auth/register', { email: 'x@mail.test', name: 'X', password: '1234567890' })
    expect(r.status).toBe(400)
    expect(r.body.fields.password).toMatch(/распространён/)
  })
})

describe('вход по паролю', () => {
  it('«нет такой почты» и «неверный пароль» — одинаковая ошибка', async () => {
    const t = await setup()
    const a = await t.browser().post('/api/auth/login', { email: 'nobody@mail.test', password: 'что-угодно-123' })
    const b = await t.browser().post('/api/auth/login', { email: 'anna@propusk.dev', password: 'неверный-пароль' })
    expect([a.status, a.body.message]).toEqual([b.status, b.body.message])
  })

  it('5 неудач подряд → блокировка на 30 с, потом пауза удваивается', async () => {
    const t = await setup()
    const b = t.browser()
    const wrong = () => b.post('/api/auth/login', { email: 'anna@propusk.dev', password: 'неверный-пароль' })
    for (let i = 0; i < 5; i++) await wrong()
    const locked = await b.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    expect(locked.status).toBe(429)
    expect(locked.body.code).toBe('locked')
    t.advance(31_000)
    expect((await wrong()).status).toBe(401) // 6-я неудача → блокировка уже на 60 с
    t.advance(31_000)
    expect((await b.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })).status).toBe(429)
    t.advance(30_000)
    expect((await b.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })).status).toBe(200)
  })

  it('заблокированный администратором не входит, даже с верным паролем', async () => {
    const t = await setup()
    const r = await t.browser().post('/api/auth/login', { email: 'boris@propusk.dev', password: t.password })
    expect(r.body.code).toBe('blocked')
  })
})

describe('токены', () => {
  it('access живёт 10 минут; refresh выдаёт новую пару и меняет cookie (ротация)', async () => {
    const t = await setup()
    const b = t.browser()
    await b.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    const firstCookie = b.cookie(CONFIG.refreshCookie)

    t.advance(11 * MIN)
    const expired = await b.get('/api/me')
    expect(expired.body.code).toBe('token-expired')

    const refreshed = await b.refresh()
    expect(refreshed.status).toBe(200)
    expect(b.cookie(CONFIG.refreshCookie)).not.toBe(firstCookie)
    expect((await b.get('/api/me')).status).toBe(200)
  })

  it('кража refresh-токена: старый токен предъявлен повторно → сессия отозвана для всех', async () => {
    const t = await setup()
    const victim = t.browser()
    await victim.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    const stolen = victim.cookie(CONFIG.refreshCookie)!

    // Вор успел воспользоваться первым — получил новую пару.
    const thief = t.browser()
    thief.setCookie(CONFIG.refreshCookie, stolen)
    expect((await thief.refresh()).status).toBe(200)

    // Жертва пытается обновиться своим (уже использованным) токеном — это повтор.
    const reuse = await victim.refresh()
    expect(reuse.body.code).toBe('refresh-reused')
    // Отозвана вся сессия: и у вора токены больше не работают.
    expect((await thief.refresh()).status).toBe(401)
    expect((await thief.get('/api/me')).status).toBe(401)
  })

  it('без заголовка X-Propusk refresh не работает (защита от CSRF)', async () => {
    const t = await setup()
    const b = t.browser()
    await b.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    expect((await b.post('/api/auth/refresh')).body.code).toBe('csrf')
  })

  it('завершили сессию с другого устройства → её access-токен перестаёт работать сразу', async () => {
    const t = await setup()
    const laptop = t.browser()
    const phone = t.browser()
    await laptop.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    await phone.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    const sessions = (await laptop.get('/api/me/sessions')).body as unknown as { id: string; current: boolean }[]
    const phoneSession = sessions.find((s) => !s.current)!
    await laptop.del(`/api/me/sessions/${phoneSession.id}`)
    expect((await phone.get('/api/me')).body.code).toBe('session-ended')
  })

  it('выход: сессия отозвана, cookie стёрта', async () => {
    const t = await setup()
    const b = t.browser()
    await b.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    await b.post('/api/auth/logout', {}, { 'x-propusk': '1' })
    expect(b.cookie(CONFIG.refreshCookie)).toBeUndefined()
    expect((await b.get('/api/me')).status).toBe(401)
  })
})

describe('двухфакторная защита', () => {
  it('пароль → билет → код из приложения → сессия; тот же код второй раз не проходит', async () => {
    const t = await setup()
    const b = t.browser()
    const step1 = await b.post('/api/auth/login', { email: 'admin@propusk.dev', password: t.password })
    expect(step1.body).toMatchObject({ mfaRequired: true })
    expect(step1.body.accessToken).toBeUndefined()

    const code = await t.adminCode()
    const step2 = await b.post('/api/auth/login/mfa', { ticket: step1.body.ticket, code })
    expect(step2.status).toBe(200)

    const again = await t.browser().post('/api/auth/login', { email: 'admin@propusk.dev', password: t.password })
    const replay = await t.browser().post('/api/auth/login/mfa', { ticket: again.body.ticket, code })
    expect(replay.body.code).toBe('mfa-invalid')
  })

  it('код восстановления — одноразовый, о входе по нему приходит письмо', async () => {
    const t = await setup()
    const login = async () => (await t.browser().post('/api/auth/login', { email: 'admin@propusk.dev', password: t.password })).body.ticket
    expect((await t.browser().post('/api/auth/login/mfa', { ticket: await login(), recoveryCode: 'demo-aaaa' })).status).toBe(200)
    expect(t.lastMail('admin@propusk.dev')!.subject).toBe('Использован код восстановления')
    expect((await t.browser().post('/api/auth/login/mfa', { ticket: await login(), recoveryCode: 'DEMO-AAAA' })).status).toBe(401)
  })

  it('билет живёт 5 минут', async () => {
    const t = await setup()
    const b = t.browser()
    const { ticket } = (await b.post('/api/auth/login', { email: 'admin@propusk.dev', password: t.password })).body
    t.advance(6 * MIN)
    expect((await b.post('/api/auth/login/mfa', { ticket, code: await t.adminCode() })).body.code).toBe('mfa-expired')
  })

  it('включение 2FA: QR → код → коды восстановления; дальше вход требует код', async () => {
    const t = await setup()
    const b = t.browser()
    await b.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    const { secret } = (await b.post('/api/me/totp/setup')).body
    const { totp } = await import('./lib/totp.ts')
    const enabled = await b.post('/api/me/totp/enable', { code: await totp(secret, t.now()) })
    expect(enabled.body.recoveryCodes).toHaveLength(10)
    expect((await t.browser().post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })).body.mfaRequired).toBe(true)
  })
})

describe('режим судо', () => {
  it('через 5 минут после входа смена пароля требует подтверждения; после него — работает и выкидывает другие устройства', async () => {
    const t = await setup()
    const b = t.browser()
    const other = t.browser()
    await b.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    await other.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    t.advance(6 * MIN)
    await b.refresh()

    expect((await b.post('/api/me/password', { password: 'совсем новый пароль' })).body.code).toBe('reauth-required')
    expect((await b.post('/api/me/step-up', { password: 'не тот' })).status).toBe(401)
    expect((await b.post('/api/me/step-up', { password: t.password })).status).toBe(200)
    expect((await b.post('/api/me/password', { password: 'совсем новый пароль' })).status).toBe(200)

    await other.refresh()
    expect((await other.get('/api/me')).status).toBe(401)
    expect((await b.get('/api/me')).status).toBe(200)
  })
})

describe('вход по ссылке и сброс пароля', () => {
  it('ссылка из письма входит один раз; для неизвестной почты ответ тот же', async () => {
    const t = await setup()
    expect((await t.browser().post('/api/auth/magic-link', { email: 'nobody@mail.test' })).status).toBe(200)
    expect(t.lastMail('nobody@mail.test')).toBeUndefined()

    await t.browser().post('/api/auth/magic-link', { email: 'anna@propusk.dev' })
    const token = t.tokenFrom(t.lastMail('anna@propusk.dev')!.link)
    expect((await t.browser().post('/api/auth/magic-link/verify', { token })).status).toBe(200)
    expect((await t.browser().post('/api/auth/magic-link/verify', { token })).status).toBe(400)
  })

  it('ссылка живёт 15 минут', async () => {
    const t = await setup()
    await t.browser().post('/api/auth/magic-link', { email: 'anna@propusk.dev' })
    t.advance(16 * MIN)
    const token = t.tokenFrom(t.lastMail('anna@propusk.dev')!.link)
    expect((await t.browser().post('/api/auth/magic-link/verify', { token })).body.code).toBe('link-invalid')
  })

  it('сброс пароля завершает все сессии', async () => {
    const t = await setup()
    const b = t.browser()
    await b.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    await t.browser().post('/api/auth/password/forgot', { email: 'anna@propusk.dev' })
    const token = t.tokenFrom(t.lastMail('anna@propusk.dev')!.link)
    expect((await t.browser().post('/api/auth/password/reset', { token, password: 'новый длинный пароль' })).status).toBe(200)
    expect((await b.get('/api/me')).body.code).toBe('session-ended')
    expect((await t.browser().post('/api/auth/login', { email: 'anna@propusk.dev', password: 'новый длинный пароль' })).status).toBe(200)
  })
})

describe('роли', () => {
  it('обычный пользователь не попадает в /api/admin; администратор блокирует — сессии жертвы завершаются', async () => {
    const t = await setup()
    const anna = t.browser()
    await anna.post('/api/auth/login', { email: 'anna@propusk.dev', password: t.password })
    expect((await anna.get('/api/admin/users')).status).toBe(403)

    const admin = t.browser()
    const { ticket } = (await admin.post('/api/auth/login', { email: 'admin@propusk.dev', password: t.password })).body
    await admin.post('/api/auth/login/mfa', { ticket, code: await t.adminCode() })
    expect((await admin.patch('/api/admin/users/u-anna', { blocked: true })).status).toBe(200)
    expect((await anna.get('/api/me')).status).toBe(401)
    expect((await admin.patch('/api/admin/users/u-admin', { role: 'user' })).body.code).toBe('self')
  })
})
