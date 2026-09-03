import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

/** Resposta crua, como o fetch entrega — sem passar por JSON. */
function reply(status: number, body: string, contentType: string) {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

afterEach(() => vi.unstubAllGlobals())

describe('cliente de API contra um endereço que não é a API', () => {
  it('200 com HTML não passa por sucesso — é o nginx da web servindo o index', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, '<!doctype html><html></html>', 'text/html')),
    )

    const err = await api.me('somn_x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toContain('não JSON')
    expect((err as ApiError).message).toContain('VITE_API_URL')
  })

  it('405 do nginx vira erro explicando a causa, não um "Erro 405" seco', async () => {
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

  it('erro de verdade da API continua mostrando a mensagem do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(401, JSON.stringify({ error: 'Chave inválida ou revogada.' }), 'application/json')),
    )

    const err = await api.me('somn_x').catch((e: unknown) => e)
    expect((err as ApiError).status).toBe(401)
    expect((err as ApiError).message).toBe('Chave inválida ou revogada.')
  })

  it('resposta JSON válida passa normalmente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply(200, JSON.stringify({ label: 'meu Mac' }), 'application/json')),
    )

    await expect(api.me('somn_x')).resolves.toMatchObject({ label: 'meu Mac' })
  })
})
