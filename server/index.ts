/**
 * Настоящий сервер на Node: npm run server, затем npm run dev:real.
 * Данные — в файле data/db.json (переживают перезапуск).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { serve } from '@hono/node-server'

import { createApp } from './app.ts'
import { type Data, emptyData } from './db.ts'

const FILE = new URL('../data/db.json', import.meta.url)
const PORT = Number(process.env.PORT ?? 8787)
const APP_URL = process.env.APP_URL ?? 'http://localhost:5174'

function load(): Data {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Data
  } catch {
    return emptyData()
  }
}

let timer: NodeJS.Timeout | null = null
const db = {
  data: load(),
  changed() {
    timer ??= setTimeout(() => {
      timer = null
      mkdirSync(new URL('../data/', import.meta.url), { recursive: true })
      writeFileSync(FILE, JSON.stringify(db.data, null, 2))
    }, 100)
  },
}

const app = await createApp({
  db,
  now: Date.now,
  appUrl: APP_URL,
  rpID: new URL(APP_URL).hostname,
  origin: new URL(APP_URL).origin,
})

serve({ fetch: app.fetch, port: PORT }, () => console.log(`Пропуск: API на http://localhost:${PORT}, сайт — ${APP_URL}`))
