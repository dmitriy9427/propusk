/**
 * Правила полей — ОДНИ для формы и для сервера. Форма проверяет их, чтобы
 * сразу показать ошибку, сервер — потому что клиенту доверять нельзя.
 * Поменяли правило здесь — оно поменялось в обоих местах.
 */
import { z } from 'zod'

/** Самые частые пароли из утечек — такие запрещаем, сколько бы символов в них ни было. */
const COMMON = ['1234567890', 'qwertyuiop', 'password123', 'йцукенгшщз', '1q2w3e4r5t', 'qwerty12345', 'iloveyou12', 'parol12345']

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Введите почту')
  .max(254, 'Слишком длинный адрес')
  .email('Похоже, в адресе опечатка')

/**
 * Пароль: длина важнее «сложности». Правила вида «заглавная, цифра, символ»
 * дают Password1! — легко угадать. Рекомендация NIST: не меньше 8–10 символов,
 * не из списка утёкших, без принудительных требований к составу.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Не короче 10 символов')
  .max(128, 'Не длиннее 128 символов')
  .refine((v) => !COMMON.includes(v.toLowerCase()), 'Этот пароль слишком распространён — его подберут первым')
  .refine((v) => new Set(v).size >= 5, 'Слишком однообразно — добавьте разных символов')

export const nameSchema = z.string().trim().min(1, 'Как к вам обращаться?').max(60, 'Не длиннее 60 символов')

export const registerSchema = z
  .object({ email: emailSchema, name: nameSchema, password: passwordSchema })
  // Имя ящика короче 4 символов («a@…») совпадало бы почти с любым паролем — его не проверяем.
  .refine((v) => {
    const local = v.email.split('@')[0] ?? ''
    return local.length < 4 || !v.password.toLowerCase().includes(local)
  }, {
    path: ['password'],
    message: 'Пароль не должен содержать почту',
  })

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Введите пароль') })

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, '6 цифр из приложения')

export const recoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-7]{4}-?[A-Z2-7]{4}$/, 'Формат: XXXX-XXXX')
  .transform((v) => (v.includes('-') ? v : `${v.slice(0, 4)}-${v.slice(4)}`))

/** Оценка пароля для подсказки под полем (0–4). Только для интерфейса: решает сервер. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < 10) return 0
  let score = 1
  if (password.length >= 14) score++
  if (/[a-zа-я]/.test(password) && /[A-ZА-Я]/.test(password)) score++
  if (/\d/.test(password) && /[^\p{L}\d]/u.test(password)) score++
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4
}
