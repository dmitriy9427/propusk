import { useQuery, useQueryClient } from '@tanstack/react-query'

import { API } from '@/auth/config'

export interface Mail {
  id: string
  to: string
  subject: string
  text: string
  link: string
  createdAt: number
}

/** Демо-почта: письма лежат на сервере (в продакшене их отправлял бы SMTP). Обновляется каждые 3 с. */
export function useMailbox() {
  return useQuery({
    queryKey: ['mail'],
    queryFn: async () => (await (await fetch(`${API}/dev/mail`)).json()) as Mail[],
    refetchInterval: 3000,
  })
}

export function useClearMailbox() {
  const client = useQueryClient()
  return async () => {
    await fetch(`${API}/dev/mail`, { method: 'DELETE' })
    await client.invalidateQueries({ queryKey: ['mail'] })
  }
}
