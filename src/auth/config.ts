/** Адрес API: на GitHub Pages сайт живёт в /propusk/, поэтому учитываем BASE_URL. */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
export const API = `${BASE}/api`
export const PROVIDER_API = `${BASE}/provider/api`
