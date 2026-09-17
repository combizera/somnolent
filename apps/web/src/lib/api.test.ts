import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

/** Raw response, as fetch hands it over — with no JSON in between. */
function reply(status: number, body: string, contentType: string) {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

afterEach(() => vi.unstubAllGlobals())

describe('API client pointed at something that is not the API', () => {
  it('a 200 with HTML is not a success — it is nginx serving the index', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, '<!doctype html><html></html>', 'text/html')),
    )

    const err = await api.me('somn_x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toContain('not JSON')
    expect((err as ApiError).message).toContain('VITE_API_URL')
  })

  it('an nginx 405 explains the cause instead of a bare "Error 405"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(405, '<html><body>405 Not Allowed</body></html>', 'text/html')),
    )

    const err = await api
      .sync('somn_x', { since: null, changes: {}, deletes: {} })
      .catch((e: unknown) => e)
    expect((err as ApiError).status).toBe(405)
    expect((err as ApiError).message).toContain('405')
    expect((err as ApiError).message).toContain('text/html')
  })

  it('a real API error still shows the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(401, JSON.stringify({ error: 'Invalid or revoked key.' }), 'application/json')),
    )

    const err = await api.me('somn_x').catch((e: unknown) => e)
    expect((err as ApiError).status).toBe(401)
    expect((err as ApiError).message).toBe('Invalid or revoked key.')
  })

  it('a down API becomes an error naming the address, not a generic failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    const err = await api.listKeys('somn_x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    // without this, the sync screen only said "Could not list the keys."
    expect((err as ApiError).message).toContain('http://localhost:4000')
    expect((err as ApiError).message).toContain('Is it running?')
  })

  it('a valid JSON response passes through normally', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, JSON.stringify({ label: 'meu Mac' }), 'application/json')),
    )

    await expect(api.me('somn_x')).resolves.toMatchObject({ label: 'meu Mac' })
  })
})
