/**
 * Сервер Пропуска внутри браузера (демо на GitHub Pages).
 *
 * MSW перехватывает запросы к /api и /provider и отдаёт их в тот же Hono-сервер,
 * что работает на Node (server/app.ts). Код сервера не знает, где он запущен.
 *
 * Единственная разница — cookie (см. server/lib/cookies.ts). Браузер не даёт
 * коду страницы задавать заголовки Cookie и Set-Cookie, поэтому MSW держит
 * cookie у себя, а мы передаём их серверу и обратно через env:
 *   входящие  → env.cookies   (MSW собрал их из своего хранилища)
 *   исходящие ← env.setCookie (сервер добавил туда Set-Cookie, MSW сохранит)
 * Ограничение демо: «HttpOnly» здесь только изображается — хранилище MSW
 * лежит в localStorage. На Node (npm run server) cookie настоящие.
 */
import { HttpResponse, http } from 'msw'
import { setupWorker } from 'msw/browser'

import { createApp } from '@server/app.ts'
import type { Data } from '@server/db.ts'
import { emptyData } from '@server/db.ts'

import { BASE } from '../auth/config'

const STORAGE_KEY = 'propusk:db:v1'

function load(): Data {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Data | null) ?? emptyData()
  } catch {
    return emptyData()
  }
}

/**
 * Сохранение — ДО ответа странице, а не «через 100 мс». С задержкой был баг:
 * нажали «Выйти» и сразу перезагрузили — отзыв сессии не успевал записаться,
 * и после перезагрузки сессия «воскресала» (docs/lessons.md, урок 8).
 */
let dirty = false
const db = {
  data: load(),
  changed() {
    dirty = true
  },
}

function flush() {
  if (!dirty) return
  dirty = false
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db.data))
  } catch {
    // приватный режим — демо работает без сохранения
  }
}
addEventListener('pagehide', flush)

export async function startMockServer() {
  const app = await createApp({
    db,
    now: Date.now,
    appUrl: `${location.origin}${BASE}`,
    rpID: location.hostname,
    origin: location.origin,
  })

  const handler = async ({ request, cookies }: { request: Request; cookies: Record<string, string> }) => {
    // Сайт может жить в подпапке (/propusk/) — сервер ждёт адреса от корня.
    const url = new URL(request.url)
    url.pathname = url.pathname.slice(BASE.length)
    // Лаборатория «Кража refresh-токена» (страница «Под капотом», только демо):
    // x-demo-cookie — запрос «вора» со своей копией cookie; его новая cookie не
    // должна попасть в общее хранилище, поэтому отдаём её в x-demo-set-cookie.
    const demoCookie = request.headers.get('x-demo-cookie')
    const env = { cookies: demoCookie ? Object.fromEntries([demoCookie.split('=') as [string, string]]) : cookies, setCookie: [] as string[] }
    // Новый запрос собираем из частей, а не new Request(url, request): тот копирует
    // и флаг keepalive (у выхода он есть), а keepalive-запросу браузер запрещает
    // тело-поток — конструктор падал, и выход отвечал 500 (docs/lessons.md, урок 9).
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
    const response = await app.fetch(new Request(url, { method: request.method, headers: request.headers, body }), env)
    flush()

    // Небольшая задержка — как у настоящей сети, чтобы были видны состояния загрузки.
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 200))

    const headers = new Headers(response.headers)
    headers.delete('set-cookie')
    if (demoCookie) {
      headers.set('x-demo-set-cookie', env.setCookie.join(', '))
    } else {
      // Пути cookie сервер пишет от корня (/api/auth); в подпапке — дописываем BASE.
      for (const cookie of env.setCookie) headers.append('set-cookie', cookie.replace('Path=/', `Path=${BASE}/`))
    }
    return new HttpResponse(response.body, { status: response.status, headers })
  }

  const worker = setupWorker(http.all(`${BASE}/api/*`, handler), http.all(`${BASE}/provider/*`, handler))
  await worker.start({
    serviceWorker: { url: `${BASE}/mockServiceWorker.js` },
    onUnhandledFrame: 'bypass',
    quiet: true,
  })
  Object.assign(window, { __propusk: { db, reset: () => (localStorage.removeItem(STORAGE_KEY), location.reload()) } })
}
