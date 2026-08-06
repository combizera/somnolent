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

async function register(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'senha-forte-123' },
  })
  return res.json().token as string
}

function makeRequestEntity(id: string, name: string, updatedAt: string) {
  return {
    id,
    workspaceId: 'ignored',
    collectionId: null,
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
  app = buildApp({ db: db as unknown as Db, jwtSecret: 'test-secret' })
  await app.ready()
})

describe('auth', () => {
  it('registra, loga e rejeita senha errada', async () => {
    const token = await register('a@ex.com')
    expect(token).toBeTruthy()

    const ok = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@ex.com', password: 'senha-forte-123' },
    })
    expect(ok.statusCode).toBe(200)

    const bad = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@ex.com', password: 'errada-errada' },
    })
    expect(bad.statusCode).toBe(401)
  })

  it('rejeita registro duplicado e senha curta', async () => {
    const dup = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'a@ex.com', password: 'senha-forte-123' },
    })
    expect(dup.statusCode).toBe(409)

    const short = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'b@ex.com', password: '123' },
    })
    expect(short.statusCode).toBe(400)
  })

  it('bloqueia rotas protegidas sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/workspaces' })
    expect(res.statusCode).toBe(401)
  })
})

describe('workspaces e colaboração', () => {
  let ownerToken: string
  let memberToken: string
  let wsId: string

  beforeAll(async () => {
    ownerToken = await register('owner@ex.com')
    memberToken = await register('member@ex.com')
    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Projeto X' },
    })
    wsId = res.json().id
  })

  it('cria workspace e lista como owner', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/workspaces',
      headers: { authorization: `Bearer ${ownerToken}` },
    })
    expect(res.json().workspaces).toEqual([{ id: wsId, name: 'Projeto X', role: 'owner' }])
  })

  it('convite dá acesso ao colega', async () => {
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/workspaces/${wsId}/invites`,
      headers: { authorization: `Bearer ${ownerToken}` },
    })
    const { code } = inviteRes.json()

    const accept = await app.inject({
      method: 'POST',
      url: `/invites/${code}/accept`,
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(accept.json()).toEqual({ id: wsId, name: 'Projeto X' })

    const list = await app.inject({
      method: 'GET',
      url: '/workspaces',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(list.json().workspaces[0].role).toBe('member')
  })

  it('não-membro não sincroniza', async () => {
    const stranger = await register('stranger@ex.com')
    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${wsId}/sync`,
      headers: { authorization: `Bearer ${stranger}` },
      payload: { since: null, changes: {}, deletes: {} },
    })
    expect(res.statusCode).toBe(403)
  })

  describe('sync', () => {
    it('push do owner chega no pull do membro', async () => {
      const entity = makeRequestEntity('req-1', 'Criada pelo owner', '2026-08-04T10:00:00.000Z')
      await app.inject({
        method: 'POST',
        url: `/workspaces/${wsId}/sync`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { since: null, changes: { requests: [entity] }, deletes: {} },
      })

      const pull = await app.inject({
        method: 'POST',
        url: `/workspaces/${wsId}/sync`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { since: null, changes: {}, deletes: {} },
      })
      const body = pull.json()
      expect(body.changes.requests).toHaveLength(1)
      expect(body.changes.requests[0].name).toBe('Criada pelo owner')
    })

    it('last-write-wins: edição mais nova vence, mais velha é ignorada', async () => {
      const newer = makeRequestEntity('req-1', 'Editada depois', '2026-08-04T12:00:00.000Z')
      await app.inject({
        method: 'POST',
        url: `/workspaces/${wsId}/sync`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { since: null, changes: { requests: [newer] }, deletes: {} },
      })

      const older = makeRequestEntity('req-1', 'Edição atrasada', '2026-08-04T11:00:00.000Z')
      await app.inject({
        method: 'POST',
        url: `/workspaces/${wsId}/sync`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { since: null, changes: { requests: [older] }, deletes: {} },
      })

      const pull = await app.inject({
        method: 'POST',
        url: `/workspaces/${wsId}/sync`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { since: null, changes: {}, deletes: {} },
      })
      expect(pull.json().changes.requests[0].name).toBe('Editada depois')
    })

    it('since filtra: cliente em dia não recebe nada de novo', async () => {
      const pull = await app.inject({
        method: 'POST',
        url: `/workspaces/${wsId}/sync`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { since: null, changes: {}, deletes: {} },
      })
      const now = pull.json().now

      const again = await app.inject({
        method: 'POST',
        url: `/workspaces/${wsId}/sync`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { since: now, changes: {}, deletes: {} },
      })
      expect(again.json().changes.requests).toHaveLength(0)
    })

    it('deleção vira tombstone e chega no outro cliente', async () => {
      await app.inject({
        method: 'POST',
        url: `/workspaces/${wsId}/sync`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { since: null, changes: {}, deletes: { requests: ['req-1'] } },
      })

      const pull = await app.inject({
        method: 'POST',
        url: `/workspaces/${wsId}/sync`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { since: null, changes: {}, deletes: {} },
      })
      const body = pull.json()
      expect(body.changes.requests).toHaveLength(0)
      expect(body.deletes.requests).toEqual(['req-1'])
    })
  })
})

describe('proxy', () => {
  it('bloqueia hosts perigosos e URLs inválidas', async () => {
    const token = await register('proxy@ex.com')
    for (const url of ['http://169.254.169.254/meta', 'http://localhost:4000/x', 'not-a-url']) {
      const res = await app.inject({
        method: 'POST',
        url: '/proxy',
        headers: { authorization: `Bearer ${token}` },
        payload: { url, method: 'GET', headers: {}, body: null },
      })
      expect(res.statusCode).toBe(400)
    }
  })
})
