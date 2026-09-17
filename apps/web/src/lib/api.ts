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
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        // Content-Type only when there is a body — Fastify rejects empty JSON with 400.
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    // `fetch` only rejects before a response: server down, DNS, CORS. Naming the
    // address beats the generic failure every screen used to show.
    throw new ApiError(0, `Could not reach the API at ${API_URL}. Is it running?`)
  }
  const raw = await res.text()
  let data: { error?: string } = {}
  if (raw.trim()) {
    try {
      data = JSON.parse(raw)
    } catch {
      // Non-JSON almost always means API_URL points at the wrong host; without
      // this branch a 200 with HTML would pass as an empty-body success.
      const type = res.headers.get('content-type')?.split(';')[0] ?? 'unknown content'
      throw new ApiError(
        res.status,
        `The API answered ${res.status} with ${type}, not JSON. Check that VITE_API_URL points at the Somnolent server — it is ${API_URL} today.`,
      )
    }
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`)
  return data as T
}

/** What a key opens — the GET /me response. */
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
  /** The key this machine is connected with. */
  mine: boolean
}

export const api = {
  /** Creates the project and returns the first write key — it is shown only here. */
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
        message: err instanceof Error ? `Proxy: ${err.message}` : 'Proxy failed.',
      }
    }
  },
}

/** The key rides in the WebSocket subprotocol, not the query: query strings
 *  land in access logs. */
export function wsUrl() {
  return `${API_URL.replace(/^http/, 'ws')}/sync/ws`
}
