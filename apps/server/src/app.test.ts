import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildApp } from './app.js'
import * as schema from './db/schema.js'
import type { Db } from './db/index.js'

let app: ReturnType<typeof buildApp>
/** Same database, but demanding a secret to create a project. */
let appFechado: ReturnType<typeof buildApp>

/** Creates a project and returns the write key born with it. */
async function newProject(name: string) {
  const res = await app.inject({ method: 'POST', url: '/projects', payload: { name } })
  const body = res.json() as { id: string; key: string }
  return body
}

const auth = (key: string) => ({ authorization: `Bearer ${key}` })

async function sync(
  key: string,
  body: Record<string, unknown> = { since: null, changes: {}, deletes: {} },
) {
  return app.inject({ method: 'POST', url: '/sync', headers: auth(key), payload: body })
}

function collectionEntity(id: string, name: string, updatedAt: string, parentId: string | null = null) {
  return { id, projectId: 'ignored', parentId, name, sortOrder: 0, version: 1, updatedAt }
}

function requestEntity(id: string, name: string, updatedAt: string, rootCollectionId?: string) {
  return {
    id,
    projectId: 'ignored',
    collectionId: rootCollectionId ?? null,
    rootCollectionId,
    name,
    method: 'GET',
    url: '{{ base_url }}/x',
    headers: [],
    queryParams: [],
    body: null,
    bodyType: 'none',
    sortOrder: 0,
    version: 1,
    updatedAt,
  }
}

beforeAll(async () => {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
  await migrate(db, { migrationsFolder })
  app = buildApp({ db: db as unknown as Db })
  await app.ready()
  appFechado = buildApp({ db: db as unknown as Db, createToken: 'segredo-do-deploy' })
  await appFechado.ready()
})

describe('access keys', () => {
  it('creating a project returns the write key exactly once', async () => {
    const { id, key } = await newProject('Catcher')
    expect(id).toBeTruthy()
    expect(key.startsWith('somn_')).toBe(true)

    const me = await app.inject({ method: 'GET', url: '/me', headers: auth(key) })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({ scope: 'project', role: 'write' })
  })

  it('refuses an unknown, empty or malformed key', async () => {
    for (const bad of ['somn_naoexiste', 'Bearer', 'abc123', '']) {
      const res = await app.inject({ method: 'GET', url: '/me', headers: auth(bad) })
      expect(res.statusCode).toBe(401)
    }
    const semHeader = await app.inject({ method: 'GET', url: '/me' })
    expect(semHeader.statusCode).toBe(401)
  })

  it('issues a new key with label and role, and lists both', async () => {
    const { key } = await newProject('Piped')
    const nova = await app.inject({
      method: 'POST',
      url: '/keys',
      headers: auth(key),
      payload: { label: 'Mac do Ygor', role: 'read' },
    })
    expect(nova.statusCode).toBe(200)
    const criada = nova.json() as { id: string; key: string; role: string }
    expect(criada.role).toBe('read')

    const lista = await app.inject({ method: 'GET', url: '/keys', headers: auth(key) })
    const keys = (lista.json() as { keys: { label: string; mine: boolean }[] }).keys
    expect(keys).toHaveLength(2)
    expect(keys.find((k) => k.label === 'Mac do Ygor')).toBeTruthy()
    expect(keys.filter((k) => k.mine)).toHaveLength(1)
  })

  it('demands a label when issuing a key', async () => {
    const { key } = await newProject('Sem rótulo')
    const res = await app.inject({
      method: 'POST',
      url: '/keys',
      headers: auth(key),
      payload: { label: '  ' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('a revoked key stops working right away', async () => {
    const { key } = await newProject('Revogar')
    const nova = await app.inject({
      method: 'POST',
      url: '/keys',
      headers: auth(key),
      payload: { label: 'notebook perdido' },
    })
    const alvo = nova.json() as { id: string; key: string }

    expect((await app.inject({ method: 'GET', url: '/me', headers: auth(alvo.key) })).statusCode).toBe(200)

    const del = await app.inject({ method: 'DELETE', url: `/keys/${alvo.id}`, headers: auth(key) })
    expect(del.statusCode).toBe(200)

    expect((await app.inject({ method: 'GET', url: '/me', headers: auth(alvo.key) })).statusCode).toBe(401)
  })

  it('a key of one project does not reach another project', async () => {
    const a = await newProject('A')
    const b = await newProject('B')
    const lista = await app.inject({ method: 'GET', url: '/keys', headers: auth(a.key) })
    const keys = (lista.json() as { keys: unknown[] }).keys
    expect(keys).toHaveLength(1) // only its own

    const del = await app.inject({
      method: 'DELETE',
      url: `/keys/${(await app.inject({ method: 'GET', url: '/keys', headers: auth(b.key) })).json().keys[0].id}`,
      headers: auth(a.key),
    })
    expect(del.statusCode).toBe(404)
  })
})

describe('read-only role', () => {
  it('reads what exists but does not write', async () => {
    const { key } = await newProject('Leitura')
    const leitura = (
      await app.inject({
        method: 'POST',
        url: '/keys',
        headers: auth(key),
        payload: { label: 'estagiário', role: 'read' },
      })
    ).json() as { key: string }

    await sync(key, {
      since: null,
      changes: { requests: [requestEntity('r1', 'existente', '2026-09-01T10:00:00.000Z')] },
      deletes: {},
    })

    const pull = await sync(leitura.key)
    expect(pull.statusCode).toBe(200)
    expect(pull.json().changes.requests).toHaveLength(1)

    const push = await sync(leitura.key, {
      since: null,
      changes: { requests: [requestEntity('r2', 'proibida', '2026-09-01T11:00:00.000Z')] },
      deletes: {},
    })
    expect(push.statusCode).toBe(403)

    // and nothing got in
    const conferir = await sync(key)
    expect(conferir.json().changes.requests.map((r: { id: string }) => r.id)).toEqual(['r1'])
  })

  it('a read key neither issues nor revokes keys', async () => {
    const { key } = await newProject('Leitura 2')
    const leitura = (
      await app.inject({
        method: 'POST',
        url: '/keys',
        headers: auth(key),
        payload: { label: 'só leitura', role: 'read' },
      })
    ).json() as { key: string }

    const emitir = await app.inject({
      method: 'POST',
      url: '/keys',
      headers: auth(leitura.key),
      payload: { label: 'tentativa' },
    })
    expect(emitir.statusCode).toBe(403)
  })
})

describe('per-collection scope', () => {
  it('a collection key reads only its own collection', async () => {
    const { key } = await newProject('Escopo')
    await sync(key, {
      since: null,
      changes: {
        collections: [
          collectionEntity('colA', 'Catcher', '2026-09-01T10:00:00.000Z'),
          collectionEntity('colB', 'Piped', '2026-09-01T10:00:00.000Z'),
        ],
        requests: [
          requestEntity('rA', 'da A', '2026-09-01T10:00:00.000Z', 'colA'),
          requestEntity('rB', 'da B', '2026-09-01T10:00:00.000Z', 'colB'),
        ],
        environments: [
          { id: 'eA', collectionId: 'colA', name: 'prod', isBase: false, variables: [], sortOrder: 0, version: 1, updatedAt: '2026-09-01T10:00:00.000Z' },
          { id: 'eB', collectionId: 'colB', name: 'prod', isBase: false, variables: [], sortOrder: 0, version: 1, updatedAt: '2026-09-01T10:00:00.000Z' },
        ],
      },
      deletes: {},
    })

    const daColA = (
      await app.inject({
        method: 'POST',
        url: '/keys',
        headers: auth(key),
        payload: { label: 'colega', collectionId: 'colA' },
      })
    ).json() as { key: string }

    const me = await app.inject({ method: 'GET', url: '/me', headers: auth(daColA.key) })
    expect(me.json()).toMatchObject({ scope: 'collection', collection: { id: 'colA', name: 'Catcher' } })

    const pull = await sync(daColA.key)
    const body = pull.json()
    expect(body.changes.collections.map((c: { id: string }) => c.id)).toEqual(['colA'])
    expect(body.changes.requests.map((r: { id: string }) => r.id)).toEqual(['rA'])
    // the environment comes along: it is what makes the collection resolve on its own
    expect(body.changes.environments.map((e: { id: string }) => e.id)).toEqual(['eA'])
  })

  it('a collection key does not write into the neighbor collection', async () => {
    const { key } = await newProject('Escopo 2')
    await sync(key, {
      since: null,
      changes: {
        collections: [
          collectionEntity('c1', 'Minha', '2026-09-01T10:00:00.000Z'),
          collectionEntity('c2', 'Do outro', '2026-09-01T10:00:00.000Z'),
        ],
      },
      deletes: {},
    })
    const daC1 = (
      await app.inject({
        method: 'POST',
        url: '/keys',
        headers: auth(key),
        payload: { label: 'c1', collectionId: 'c1' },
      })
    ).json() as { key: string }

    const push = await sync(daC1.key, {
      since: null,
      changes: {
        requests: [
          requestEntity('ok', 'permitida', '2026-09-01T11:00:00.000Z', 'c1'),
          requestEntity('nao', 'invasora', '2026-09-01T11:00:00.000Z', 'c2'),
        ],
      },
      deletes: {},
    })
    expect(push.statusCode).toBe(200)

    const tudo = await sync(key)
    const ids = tudo.json().changes.requests.map((r: { id: string }) => r.id)
    expect(ids).toContain('ok')
    expect(ids).not.toContain('nao')
  })

  it('a collection key does not issue a key broader than itself', async () => {
    const { key } = await newProject('Escopo 3')
    await sync(key, {
      since: null,
      changes: { collections: [collectionEntity('cx', 'X', '2026-09-01T10:00:00.000Z')] },
      deletes: {},
    })
    const daCx = (
      await app.inject({
        method: 'POST',
        url: '/keys',
        headers: auth(key),
        payload: { label: 'cx', collectionId: 'cx' },
      })
    ).json() as { key: string }

    const ampliar = await app.inject({
      method: 'POST',
      url: '/keys',
      headers: auth(daCx.key),
      payload: { label: 'quero tudo' },
    })
    expect(ampliar.statusCode).toBe(403)
  })
})

describe('sync', () => {
  it('a push from one key arrives in the pull of another', async () => {
    const { key } = await newProject('Sync 1')
    const colega = (
      await app.inject({
        method: 'POST',
        url: '/keys',
        headers: auth(key),
        payload: { label: 'colega' },
      })
    ).json() as { key: string }

    await sync(key, {
      since: null,
      changes: { requests: [requestEntity('r1', 'Login', '2026-09-01T10:00:00.000Z')] },
      deletes: {},
    })
    const pull = await sync(colega.key)
    expect(pull.json().changes.requests[0].name).toBe('Login')
  })

  it('last-write-wins: the newer edit wins, the older one is ignored', async () => {
    const { key } = await newProject('Sync 2')
    await sync(key, {
      since: null,
      changes: { requests: [requestEntity('r1', 'nova', '2026-09-01T12:00:00.000Z')] },
      deletes: {},
    })
    await sync(key, {
      since: null,
      changes: { requests: [requestEntity('r1', 'velha', '2026-09-01T09:00:00.000Z')] },
      deletes: {},
    })
    const pull = await sync(key)
    expect(pull.json().changes.requests[0].name).toBe('nova')
  })

  it('since filters: a client up to date receives nothing new', async () => {
    const { key } = await newProject('Sync 3')
    const primeiro = await sync(key, {
      since: null,
      changes: { requests: [requestEntity('r1', 'x', '2026-09-01T10:00:00.000Z')] },
      deletes: {},
    })
    const now = primeiro.json().now as string

    const segundo = await sync(key, { since: now, changes: {}, deletes: {} })
    expect(segundo.json().changes.requests).toHaveLength(0)
  })

  it('a deletion becomes a tombstone and reaches the other end', async () => {
    const { key } = await newProject('Sync 4')
    const colega = (
      await app.inject({
        method: 'POST',
        url: '/keys',
        headers: auth(key),
        payload: { label: 'colega' },
      })
    ).json() as { key: string }

    await sync(key, {
      since: null,
      changes: { requests: [requestEntity('r1', 'some', '2026-09-01T10:00:00.000Z')] },
      deletes: {},
    })
    await sync(colega.key)
    await sync(key, { since: null, changes: {}, deletes: { requests: ['r1'] } })

    const pull = await sync(colega.key)
    expect(pull.json().deletes.requests).toContain('r1')
    expect(pull.json().changes.requests).toHaveLength(0)
  })
})

describe('project creation closed by token', () => {
  it('refuses creation without the secret', async () => {
    const res = await appFechado.inject({
      method: 'POST',
      url: '/projects',
      payload: { name: 'Tentativa' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('refuses a wrong secret', async () => {
    const res = await appFechado.inject({
      method: 'POST',
      url: '/projects',
      headers: { 'x-create-token': 'chute' },
      payload: { name: 'Tentativa' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('accepts the right secret and returns a usable key', async () => {
    const res = await appFechado.inject({
      method: 'POST',
      url: '/projects',
      headers: { 'x-create-token': 'segredo-do-deploy' },
      payload: { name: 'Autorizado' },
    })
    expect(res.statusCode).toBe(200)
    const { key } = res.json() as { key: string }
    const me = await appFechado.inject({ method: 'GET', url: '/me', headers: auth(key) })
    expect(me.json()).toMatchObject({ project: { name: 'Autorizado' } })
  })

  it('a server with no token configured keeps creating freely', async () => {
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { name: 'Livre' } })
    expect(res.statusCode).toBe(200)
  })
})

describe('proxy', () => {
  it('blocks dangerous hosts and invalid URLs', async () => {
    const { key } = await newProject('Proxy')
    for (const url of ['http://169.254.169.254/latest', 'http://localhost:4000/x', 'nao-e-url']) {
      const res = await app.inject({
        method: 'POST',
        url: '/proxy',
        headers: auth(key),
        payload: { url, method: 'GET', headers: {}, body: null },
      })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
    }
  })

  it('demands a key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/proxy',
      payload: { url: 'https://example.com', method: 'GET', headers: {}, body: null },
    })
    expect(res.statusCode).toBe(401)
  })
})
