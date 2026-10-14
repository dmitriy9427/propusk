/**
 * Ошибки API в одном формате: { code, message, fields? }.
 * code — для программы (клиент по нему решает, что делать: 'mfa-required',
 * 'reauth-required'…), message — для человека.
 */
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { z } from 'zod'

export class ApiError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string
  readonly fields?: Record<string, string>
  /** Через сколько секунд можно повторить (для 429). */
  readonly retryAfter?: number

  constructor(status: ContentfulStatusCode, code: string, message: string, fields?: Record<string, string>, retryAfter?: number) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfter = retryAfter
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new ApiError(400, 'invalid', message, fields)
export const unauthorized = (code = 'unauthorized', message = 'Нужно войти') => new ApiError(401, code, message)
export const forbidden = (code = 'forbidden', message = 'Недостаточно прав') => new ApiError(403, code, message)

/**
 * Прочитать JSON из запроса и проверить схемой zod. Ошибки — по полям,
 * в том же виде, что показывает форма: { email: 'Похоже, в адресе опечатка' }.
 */
export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw: unknown = await c.req.json().catch(() => ({}))
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) fields[issue.path.join('.')] ??= issue.message
  throw badRequest('Проверьте поля', fields)
}
