/** Ошибка API в том же виде, что отдаёт сервер: { code, message, fields }. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>
  readonly retryAfter: number | null

  constructor(status: number, body: { code?: string; message?: string; fields?: Record<string, string> }, retryAfter: number | null = null) {
    super(body.message ?? `Ошибка ${status}`)
    this.status = status
    this.code = body.code ?? 'unknown'
    this.fields = body.fields ?? {}
    this.retryAfter = retryAfter
  }
}

export async function toApiError(res: Response) {
  const body = await res.json().catch(() => ({}))
  const retry = res.headers.get('retry-after')
  return new ApiError(res.status, body, retry ? Number(retry) : null)
}

export const isApiError = (error: unknown, code?: string): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code)
