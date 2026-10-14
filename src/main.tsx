import '@fontsource-variable/manrope'
import '@fontsource-variable/jetbrains-mono'
import './styles/global.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'

import { createAppRouter } from './app/routes'
import { ApiError } from './auth/errors'
import { listenToOtherTabs } from './auth/session'

// Демо: сервер в браузере. С настоящим сервером (npm run dev:real) — пропускаем.
if (!import.meta.env.VITE_REAL_SERVER) {
  const { startMockServer } = await import('./mocks/browser')
  await startMockServer()
}

listenToOtherTabs()
const router = createAppRouter()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // 401/403 повторять бесполезно: api() уже сделал всё, что мог.
      retry: (count, error) => count < 2 && !(error instanceof ApiError && [401, 403, 404].includes(error.status)),
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
