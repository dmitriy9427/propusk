/**
 * Данные кабинета — TanStack Query поверх api(). Ключи запросов в одном месте:
 * мутации инвалидируют их, и экран обновляется сам.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/auth/http'
import { patchUser } from '@/auth/session-store'
import type { PublicUser } from '@server/core.ts'

export const keys = {
  me: ['me'] as const,
  sessions: ['sessions'] as const,
  passkeys: ['passkeys'] as const,
  activity: ['activity'] as const,
  users: ['admin', 'users'] as const,
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      const user = await api<PublicUser>('/me')
      patchUser(user) // имя в шапке тоже обновится
      return user
    },
  })
}

export interface SessionInfo {
  id: string
  userAgent: string
  method: string
  createdAt: number
  lastUsedAt: number
  current: boolean
}

export const useSessions = () => useQuery({ queryKey: keys.sessions, queryFn: () => api<SessionInfo[]>('/me/sessions') })

export interface PasskeyInfo {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
}

export const usePasskeys = () => useQuery({ queryKey: keys.passkeys, queryFn: () => api<PasskeyInfo[]>('/me/passkeys') })

export interface AuditEvent {
  id: string
  type: string
  at: number
  userAgent: string
  details: string
}

export const useActivity = () => useQuery({ queryKey: keys.activity, queryFn: () => api<AuditEvent[]>('/me/activity') })

/** Мутация, после которой обновляем всё «о себе»: профиль, ключи, журнал. */
export function useAccountMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.me })
      void client.invalidateQueries({ queryKey: keys.passkeys })
      void client.invalidateQueries({ queryKey: keys.activity })
      void client.invalidateQueries({ queryKey: keys.sessions })
    },
  })
}
