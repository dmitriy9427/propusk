/** «14 окт., 12:30» и «5 минут назад». */
export const formatDateTime = (ms: number) =>
  new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const rtf = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' })
export function formatAgo(ms: number) {
  const diff = (ms - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'только что'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

/** Очень грубо: браузер и система по User-Agent — для подписи устройства. */
export function describeDevice(ua: string) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Браузер'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser}, ${os}` : browser
}

export const METHOD_LABEL: Record<string, string> = {
  password: 'пароль',
  'password+totp': 'пароль + код 2FA',
  'magic-link': 'ссылка из письма',
  passkey: 'ключ доступа',
  romashka: 'Ромашка ID',
}
