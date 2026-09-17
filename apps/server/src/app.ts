import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import type { WebSocket } from '@fastify/websocket'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'
import type { Db } from './db/index.js'
import { accessKeys, entities, projects } from './db/schema.js'

export interface AppOptions {
  db: Db
  /**
   * When set, creating a project requires this secret in the `X-Create-Token`
   * header. Empty leaves creation open — fine locally, bad when exposed.
   */
  createToken?: string
}

/** What a key opens. Resolved on the server, never taken from the client. */
export interface Access {
  keyId: string
  projectId: string
  /** null = project key (opens everything); id = key for a single collection. */
  collectionId: string | null
  role: 'write' | 'read'
  label: string
}

type Kind = 'collection' | 'request' | 'environment'
const KINDS: Kind[] = ['collection', 'request', 'environment']

interface SyncEntity {
  id: string
  updatedAt: string
  [key: string]: unknown
}

interface SyncBody {
  since: string | null
  changes: Partial<Record<`${Kind}s`, SyncEntity[]>>
  deletes: Partial<Record<`${Kind}s`, string[]>>
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Filled in by the `requireKey`/`requireWrite` guards. */
    access?: Access
  }
}

const KEY_PREFIX = 'somn_'
const hashKey = (raw: string) => createHash('sha256').update(raw).digest('hex')
const newKey = () => `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`

export function buildApp({ db, createToken }: AppOptions) {
  const app = Fastify({ logger: false })

  app.register(cors, { origin: true })
  app.register(websocket)

  // WebSocket rooms per project, to notify changes in real time.
  const rooms = new Map<string, Set<WebSocket>>()
  const broadcast = (projectId: string, except?: string) => {
    const room = rooms.get(projectId)
    if (!room) return
    const msg = JSON.stringify({ type: 'changed', projectId, by: except ?? null })
    for (const socket of room) {
      if (socket.readyState === socket.OPEN) socket.send(msg)
    }
  }

  // Owning key of each open socket: it is what lets a revoke drop exactly
  // the sockets of that key.
  const socketKeys = new Map<WebSocket, string>()

  /** Reads the key from the header and resolves its scope; null if invalid or revoked. */
  async function resolveKey(raw: string | undefined): Promise<Access | null> {
    if (!raw?.startsWith(KEY_PREFIX)) return null
    const [row] = await db
      .select()
      .from(accessKeys)
      .where(and(eq(accessKeys.tokenHash, hashKey(raw)), isNull(accessKeys.revokedAt)))
    if (!row) return null
    // mark the use without blocking the response: a liveness hint, not a transaction
    void db
      .update(accessKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(accessKeys.id, row.id))
      .catch(() => {})
    return {
      keyId: row.id,
      projectId: row.projectId,
      collectionId: row.scope === 'collection' ? row.collectionId : null,
      role: row.role,
      label: row.label,
    }
  }

  const bearerOf = (req: { headers: Record<string, unknown> }) => {
    const header = req.headers['authorization']
    return typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7)
      : undefined
  }

  /** Attaches the access to the request; 401 when the key opens nothing. */
  const requireKey = async (
    req: { headers: Record<string, unknown>; access?: Access },
    reply: { code: (c: number) => { send: (b: unknown) => void } },
  ) => {
    const access = await resolveKey(bearerOf(req))
    if (!access) return reply.code(401).send({ error: 'Invalid or revoked key.' })
    req.access = access
  }

  const requireWrite = async (
    req: { headers: Record<string, unknown>; access?: Access },
    reply: { code: (c: number) => { send: (b: unknown) => void } },
  ) => {
    await requireKey(req, reply)
    if (req.access && req.access.role !== 'write') {
      reply.code(403).send({ error: 'This key is read-only.' })
    }
  }

  /**
   * Root collection of an entity arriving in the sync. The client already sends
   * the hierarchy; the root collection is the one without a parent.
   */
  const rootOf = (kind: Kind, entity: SyncEntity): string | null => {
    if (kind === 'collection') {
      return (entity.parentId as string | null) === null
        ? entity.id
        : ((entity.rootCollectionId as string | undefined) ?? null)
    }
    if (kind === 'environment') return (entity.collectionId as string | null) ?? null
    return (entity.rootCollectionId as string | undefined) ?? null
  }

  /** Is an entity within the key's scope? A project key opens everything. */
  const inScope = (access: Access, rootCollectionId: string | null | undefined) =>
    access.collectionId === null || rootCollectionId === access.collectionId

  // ---------- projects and keys ----------

  app.post<{ Body: { name: string } }>('/projects', async (req, reply) => {
    if (createToken && req.headers['x-create-token'] !== createToken) {
      return reply.code(403).send({ error: 'This server does not accept open project creation.' })
    }
    const name = req.body?.name?.trim()
    if (!name) return reply.code(400).send({ error: 'The project name is required.' })

    const [project] = await db.insert(projects).values({ name }).returning()
    const raw = newKey()
    await db.insert(accessKeys).values({
      tokenHash: hashKey(raw),
      scope: 'project',
      projectId: project!.id,
      role: 'write',
      label: 'first key',
    })
    // The raw key shows up once: from here on only the hash exists.
    return { id: project!.id, name: project!.name, key: raw }
  })

  /** What this key opens — the client calls it before downloading anything. */
  app.get('/me', { onRequest: [requireKey] }, async (req) => {
    const access = req.access!
    const [project] = await db.select().from(projects).where(eq(projects.id, access.projectId))
    let collectionName: string | null = null
    if (access.collectionId) {
      const [row] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.projectId, access.projectId), eq(entities.id, access.collectionId)))
      collectionName = (row?.data as { name?: string } | undefined)?.name ?? null
    }
    return {
      scope: access.collectionId ? 'collection' : 'project',
      role: access.role,
      label: access.label,
      project: { id: access.projectId, name: project?.name ?? '' },
      collection: access.collectionId ? { id: access.collectionId, name: collectionName } : null,
    }
  })

  app.get('/keys', { onRequest: [requireKey] }, async (req) => {
    const access = req.access!
    const rows = await db
      .select()
      .from(accessKeys)
      .where(and(eq(accessKeys.projectId, access.projectId), isNull(accessKeys.revokedAt)))
    // A collection key only sees the keys of its own collection.
    const visible = rows.filter((r) => inScope(access, r.collectionId ?? null) || r.scope === 'project')
    return {
      keys: visible.map((r) => ({
        id: r.id,
        label: r.label,
        role: r.role,
        scope: r.scope,
        collectionId: r.collectionId,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        mine: r.id === access.keyId,
      })),
    }
  })

  app.post<{ Body: { label: string; role?: 'write' | 'read'; collectionId?: string | null } }>(
    '/keys',
    { onRequest: [requireWrite] },
    async (req, reply) => {
      const access = req.access!
      const label = req.body?.label?.trim()
      if (!label) return reply.code(400).send({ error: 'Give the key a label, e.g. "my Mac".' })

      const collectionId = req.body?.collectionId ?? null
      // A collection key cannot issue a key broader than itself.
      if (access.collectionId && collectionId !== access.collectionId) {
        return reply.code(403).send({ error: 'This key only issues keys for its own collection.' })
      }

      const raw = newKey()
      const [row] = await db
        .insert(accessKeys)
        .values({
          tokenHash: hashKey(raw),
          scope: collectionId ? 'collection' : 'project',
          projectId: access.projectId,
          collectionId,
          role: req.body?.role === 'read' ? 'read' : 'write',
          label,
        })
        .returning()
      return { id: row!.id, label: row!.label, role: row!.role, key: raw }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/keys/:id',
    { onRequest: [requireWrite] },
    async (req, reply) => {
      const access = req.access!
      const [row] = await db.select().from(accessKeys).where(eq(accessKeys.id, req.params.id))
      if (!row || row.projectId !== access.projectId) {
        return reply.code(404).send({ error: 'Key not found.' })
      }
      if (access.collectionId && row.collectionId !== access.collectionId) {
        return reply.code(403).send({ error: 'This key does not reach the key you want to revoke.' })
      }
      await db
        .update(accessKeys)
        .set({ revokedAt: new Date() })
        .where(eq(accessKeys.id, req.params.id))
      // drop the sockets opened with the revoked key — without this, whoever
      // was cut off would keep receiving every change in real time
      for (const [socket, keyId] of socketKeys) {
        if (keyId === req.params.id) socket.close(4001, 'revoked key')
      }
      return { revoked: true }
    },
  )

  // ---------- sync ----------

  app.post<{ Body: SyncBody }>('/sync', { onRequest: [requireKey] }, async (req, reply) => {
    const access = req.access!
    const projectId = access.projectId
    const { since = null, changes = {}, deletes = {} } = req.body ?? {}
    const now = new Date()
    const pushed =
      KINDS.some((kind) => (changes[`${kind}s`]?.length ?? 0) > 0) ||
      KINDS.some((kind) => (deletes[`${kind}s`]?.length ?? 0) > 0)

    if (pushed && access.role !== 'write') {
      return reply.code(403).send({ error: 'This key is read-only.' })
    }

    for (const kind of KINDS) {
      for (const entity of changes[`${kind}s`] ?? []) {
        if (!entity?.id || !entity.updatedAt) continue
        const rootCollectionId = rootOf(kind, entity)
        // A collection key does not write outside its own collection.
        if (!inScope(access, rootCollectionId)) continue
        const updatedAt = new Date(entity.updatedAt)
        // Last-write-wins: only writes when it is newer than what the server has.
        await db
          .insert(entities)
          .values({
            id: entity.id,
            projectId,
            rootCollectionId,
            kind,
            data: entity,
            updatedAt,
            deleted: false,
            syncedAt: now,
          })
          .onConflictDoUpdate({
            target: [entities.projectId, entities.id],
            set: { data: entity, rootCollectionId, updatedAt, deleted: false, syncedAt: now },
            setWhere: sql`${entities.updatedAt} < ${updatedAt}`,
          })
      }
      for (const id of deletes[`${kind}s`] ?? []) {
        await db
          .update(entities)
          .set({ deleted: true, updatedAt: now, syncedAt: now })
          .where(
            and(
              eq(entities.projectId, projectId),
              eq(entities.id, id),
              access.collectionId
                ? eq(entities.rootCollectionId, access.collectionId)
                : sql`true`,
            ),
          )
      }
    }

    // Returns everything changed on the server since the client's last sync,
    // cut down to the key's scope.
    const scopeFilter = access.collectionId
      ? eq(entities.rootCollectionId, access.collectionId)
      : sql`true`
    const changedRows = await db
      .select()
      .from(entities)
      .where(
        since
          ? and(eq(entities.projectId, projectId), scopeFilter, gt(entities.syncedAt, new Date(since)))
          : and(eq(entities.projectId, projectId), scopeFilter),
      )

    const out: Record<string, unknown[]> = {}
    const tombstones: Record<string, string[]> = {}
    for (const kind of KINDS) {
      out[`${kind}s`] = changedRows.filter((r) => r.kind === kind && !r.deleted).map((r) => r.data)
      tombstones[`${kind}s`] = changedRows
        .filter((r) => r.kind === kind && r.deleted)
        .map((r) => r.id)
    }

    // Only notify the room when this push really carried changes — otherwise
    // each pull triggers another and the room loops.
    if (pushed) broadcast(projectId, access.keyId)

    return { now: now.toISOString(), changes: out, deletes: tombstones }
  })

  // ---------- websocket ----------
  // Must sit in a scope registered AFTER the websocket plugin loads, or the
  // route becomes a plain GET and the handshake fails with a 500.
  app.register(async (scope) => {
    scope.get(
      '/sync/ws',
      { websocket: true },
      async (socket, req) => {
        // The key rides the subprotocol, not the query: queries land in access logs.
        const offered = req.headers['sec-websocket-protocol']
        const raw =
          (typeof offered === 'string' ? offered.split(',').map((v) => v.trim()) : [])
            .find((v) => v.startsWith(KEY_PREFIX)) ?? bearerOf(req)
        const access = await resolveKey(raw)
        if (!access) {
          socket.close(4001, 'invalid key')
          return
        }
        const room = rooms.get(access.projectId) ?? new Set()
        room.add(socket)
        rooms.set(access.projectId, room)
        socketKeys.set(socket, access.keyId)
        socket.on('close', () => {
          room.delete(socket)
          socketKeys.delete(socket)
        })
      },
    )
  })

  // ---------- CORS proxy for the web build ----------

  app.post<{ Body: { url: string; method: string; headers: Record<string, string>; body: string | null } }>(
    '/proxy',
    { onRequest: [requireKey] },
    async (req, reply) => {
      const { url, method, headers = {}, body = null } = req.body ?? {}
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return reply.code(400).send({ error: 'Invalid URL.' })
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return reply.code(400).send({ error: 'Only http/https are supported.' })
      }
      // Minimal SSRF guard for the MVP: blocks cloud metadata and loopback.
      if (['169.254.169.254', 'metadata.google.internal', 'localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(parsed.hostname)) {
        return reply.code(400).send({ error: 'Host not allowed by the proxy.' })
      }
      try {
        const res = await fetch(parsed, {
          method,
          headers,
          body: body !== null && !['GET', 'HEAD'].includes(method) ? body : undefined,
          signal: AbortSignal.timeout(30_000),
          redirect: 'follow',
        })
        const text = await res.text()
        return {
          status: res.status,
          statusText: res.statusText,
          headers: [...res.headers.entries()].map(([key, value]) => ({ key, value })),
          body: text,
        }
      } catch (err) {
        return reply.code(502).send({
          error: err instanceof Error ? err.message : 'Failed to reach the target.',
        })
      }
    },
  )

  app.get('/health', async () => ({ ok: true }))

  return app
}
