import type { ResolvedRequest } from '@somnolent/core'
import type { SendResult, SendError } from './send'

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, options: { method?: string; token?: string | null; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      // Content-Type só quando há body — Fastify rejeita JSON vazio com 400.
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status}`)
  return data as T
}

export const api = {
  register: (email: string, password: string) =>
    call<{ token: string; email: string }>('/auth/register', {
      method: 'POST',
      body: { email, password },
    }),

  login: (email: string, password: string) =>
    call<{ token: string; email: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  listWorkspaces: (token: string) =>
    call<{ workspaces: { id: string; name: string; role: string }[] }>('/workspaces', { token }),

  createWorkspace: (token: string, name: string) =>
    call<{ id: string; name: string }>('/workspaces', { method: 'POST', token, body: { name } }),

  createInvite: (token: string, workspaceId: string) =>
    call<{ code: string }>(`/workspaces/${workspaceId}/invites`, { method: 'POST', token }),

  acceptInvite: (token: string, code: string) =>
    call<{ id: string; name: string }>(`/invites/${code}/accept`, { method: 'POST', token }),

  sync: (
    token: string,
    workspaceId: string,
    payload: {
      since: string | null
      changes: Record<string, unknown[]>
      deletes: Record<string, string[]>
    },
  ) =>
    call<{
      now: string
      changes: Record<string, unknown[]>
      deletes: Record<string, string[]>
    }>(`/workspaces/${workspaceId}/sync`, { method: 'POST', token, body: payload }),

  proxy: async (token: string, resolved: ResolvedRequest): Promise<SendResult | SendError> => {
    const started = performance.now()
    try {
      const data = await call<{
        status: number
        statusText: string
        headers: { key: string; value: string }[]
        body: string
      }>('/proxy', {
        method: 'POST',
        token,
        body: {
          url: resolved.url,
          method: resolved.method,
          headers: Object.fromEntries(resolved.headers.map((h) => [h.key, h.value])),
          body: resolved.body,
        },
      })
      return {
        ok: true,
        ...data,
        timeMs: Math.round(performance.now() - started),
        sizeBytes: new Blob([data.body]).size,
      }
    } catch (err) {
      return {
        ok: false,
        timeMs: Math.round(performance.now() - started),
        message: err instanceof Error ? `Proxy: ${err.message}` : 'Falha no proxy.',
      }
    }
  },
}

export function wsUrl(workspaceId: string, token: string) {
  return `${API_URL.replace(/^http/, 'ws')}/workspaces/${workspaceId}/ws?token=${encodeURIComponent(token)}`
}
