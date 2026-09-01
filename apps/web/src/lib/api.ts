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

async function call<T>(
  path: string,
  options: {
    method?: string
    token?: string | null
    body?: unknown
    headers?: Record<string, string>
  } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      // Content-Type só quando há body — Fastify rejeita JSON vazio com 400.
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status}`)
  return data as T
}

/** O que uma chave abre — resposta de GET /me. */
export interface KeyInfo {
  scope: 'project' | 'collection'
  role: 'write' | 'read'
  label: string
  project: { id: string; name: string }
  collection: { id: string; name: string | null } | null
}

export interface KeyRow {
  id: string
  label: string
  role: 'write' | 'read'
  scope: 'project' | 'collection'
  collectionId: string | null
  createdAt: string
  lastUsedAt: string | null
  /** É a chave com que esta máquina está conectada. */
  mine: boolean
}

export const api = {
  /** Cria o project e devolve a primeira chave de escrita — ela só aparece aqui. */
  createProject: (name: string, createToken?: string) =>
    call<{ id: string; name: string; key: string }>('/projects', {
      method: 'POST',
      body: { name },
      headers: createToken ? { 'X-Create-Token': createToken } : undefined,
    }),

  me: (key: string) => call<KeyInfo>('/me', { token: key }),

  listKeys: (key: string) => call<{ keys: KeyRow[] }>('/keys', { token: key }),

  createKey: (
    key: string,
    body: { label: string; role: 'write' | 'read'; collectionId?: string | null },
  ) =>
    call<{ id: string; label: string; role: string; key: string }>('/keys', {
      method: 'POST',
      token: key,
      body,
    }),

  revokeKey: (key: string, id: string) =>
    call<{ revoked: boolean }>(`/keys/${id}`, { method: 'DELETE', token: key }),

  sync: (
    key: string,
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
    }>('/sync', { method: 'POST', token: key, body: payload }),

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

/**
 * A chave não vai na query: query entra em log de acesso. Ela viaja no
 * subprotocolo do WebSocket — ver o segundo argumento de `new WebSocket`.
 */
export function wsUrl() {
  return `${API_URL.replace(/^http/, 'ws')}/sync/ws`
}
