import type { ResolvedRequest } from '@somnolent/core'

export interface SendResult {
  ok: true
  status: number
  statusText: string
  timeMs: number
  sizeBytes: number
  headers: { key: string; value: string }[]
  body: string
}

export interface SendError {
  ok: false
  message: string
  timeMs: number
  /** Failed before any response (offline, DNS, CORS) — candidate for a proxy retry. */
  network?: boolean
}

export async function sendRequest(resolved: ResolvedRequest): Promise<SendResult | SendError> {
  const started = performance.now()
  try {
    const headers = new Headers()
    for (const h of resolved.headers) {
      if (h.key.trim()) headers.set(h.key, h.value)
    }
    const hasBody = resolved.body !== null && !['GET', 'HEAD'].includes(resolved.method)

    const res = await fetch(resolved.url, {
      method: resolved.method,
      headers,
      body: hasBody ? resolved.body : undefined,
    })
    const blob = await res.blob()
    const body = await blob.text()
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      timeMs: Math.round(performance.now() - started),
      sizeBytes: blob.size,
      headers: [...res.headers.entries()].map(([key, value]) => ({ key, value })),
      body,
    }
  } catch (err) {
    const isNetwork = err instanceof TypeError
    return {
      ok: false,
      timeMs: Math.round(performance.now() - started),
      network: isNetwork,
      message: isNetwork
        ? 'Network failure: the API is down or the browser blocked it by CORS. Sign in to retry automatically through the server proxy, which CORS does not affect.'
        : err instanceof Error
          ? err.message
          : String(err),
    }
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatTime(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}
