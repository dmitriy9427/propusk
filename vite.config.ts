import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Два режима разработки:
 *   npm run dev       — сервер в браузере (MSW), как на GitHub Pages;
 *   npm run dev:real  — настоящий сервер на Node (npm run server), запросы /api
 *                       и /provider проксируются на него. Cookie — настоящие.
 */
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@server': fileURLToPath(new URL('./server', import.meta.url)),
    },
  },
  build: {
    // Самый большой файл — демо-сервер (Hono, jose, разбор WebAuthn): ~900 КБ без
    // сжатия. Он грузится отдельно и только в демо; с настоящим сервером его нет.
    chunkSizeWarningLimit: 1000,
  },
  define: { 'import.meta.env.VITE_REAL_SERVER': JSON.stringify(mode === 'real') },
  server: {
    port: 5174,
    proxy: mode === 'real' ? { '/api': 'http://localhost:8787', '/provider': 'http://localhost:8787' } : undefined,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    css: false,
  },
}))
