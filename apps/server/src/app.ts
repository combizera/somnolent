import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import type { WebSocket } from '@fastify/websocket'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Db } from './db/index.js'
import { accessKeys, entities, projects } from './db/schema.js'

export interface AppOptions {
  db: Db
  /**
   * Se definido, criar project exige este segredo no header
   * `X-Create-Token`. Vazio deixa a criação livre — bom pro servidor local,
   * ruim pra uma instância exposta.
   */
  createToken?: string
}

/** O que uma chave abre. Resolvido no servidor, nunca informado pelo cliente. */
export interface Access {
  keyId: string
  projectId: string
  /** null = chave de project (abre tudo); id = chave de uma collection só. */
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
    /** Preenchido pelos guards `requireKey`/`requireWrite`. */
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

  // Salas de WebSocket por project, para notificar mudanças em tempo real.
  const rooms = new Map<string, Set<WebSocket>>()
  const broadcast = (projectId: string, except?: string) => {
    const room = rooms.get(projectId)
    if (!room) return
    const msg = JSON.stringify({ type: 'changed', projectId, by: except ?? null })
    for (const socket of room) {
      if (socket.readyState === socket.OPEN) socket.send(msg)
    }
  }

  /** Derruba os sockets abertos com uma chave que acabou de ser revogada. */
  const revokedKeys = new Set<string>()

  /** Lê a chave do header e resolve o escopo; null se inválida ou revogada. */
  async function resolveKey(raw: string | undefined): Promise<Access | null> {
    if (!raw?.startsWith(KEY_PREFIX)) return null
    const [row] = await db
      .select()
      .from(accessKeys)
      .where(and(eq(accessKeys.tokenHash, hashKey(raw)), isNull(accessKeys.revokedAt)))
    if (!row) return null
    // marca o uso sem bloquear a resposta: é sinal de chave viva, não transação
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

  /** Anexa o acesso à request; 401 se a chave não abre nada. */
  const requireKey = async (
    req: { headers: Record<string, unknown>; access?: Access },
    reply: { code: (c: number) => { send: (b: unknown) => void } },
  ) => {
    const access = await resolveKey(bearerOf(req))
    if (!access) return reply.code(401).send({ error: 'Chave inválida ou revogada.' })
    req.access = access
  }

  const requireWrite = async (
    req: { headers: Record<string, unknown>; access?: Access },
    reply: { code: (c: number) => { send: (b: unknown) => void } },
  ) => {
    await requireKey(req, reply)
    if (req.access && req.access.role !== 'write') {
      reply.code(403).send({ error: 'Esta chave é somente leitura.' })
    }
  }

  /**
   * Collection raiz de uma entidade que chega no sync. O cliente já manda a
   * hierarquia; a collection raiz é a que não tem pai.
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

  /** Uma entidade está no escopo da chave? Chave de project abre tudo. */
  const inScope = (access: Access, rootCollectionId: string | null | undefined) =>
    access.collectionId === null || rootCollectionId === access.collectionId

  // ---------- projects e chaves ----------

  app.post<{ Body: { name: string } }>('/projects', async (req, reply) => {
    if (createToken && req.headers['x-create-token'] !== createToken) {
      return reply.code(403).send({ error: 'Este servidor não aceita criação aberta de project.' })
    }
    const name = req.body?.name?.trim()
    if (!name) return reply.code(400).send({ error: 'Nome do project é obrigatório.' })

    const [project] = await db.insert(projects).values({ name }).returning()
    const raw = newKey()
    await db.insert(accessKeys).values({
      tokenHash: hashKey(raw),
      scope: 'project',
      projectId: project!.id,
      role: 'write',
      label: 'primeira chave',
    })
    // A chave crua aparece uma vez: daqui em diante só existe o hash.
    return { id: project!.id, name: project!.name, key: raw }
  })

  /** O que esta chave abre — o cliente chama antes de baixar qualquer coisa. */
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
    // Chave de collection só enxerga as chaves da própria collection.
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
      if (!label) return reply.code(400).send({ error: 'Dê um rótulo à chave, ex.: "meu Mac".' })

      const collectionId = req.body?.collectionId ?? null
      // Uma chave de collection não pode emitir chave mais ampla que ela mesma.
      if (access.collectionId && collectionId !== access.collectionId) {
        return reply.code(403).send({ error: 'Esta chave só emite chaves da própria collection.' })
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
        return reply.code(404).send({ error: 'Chave não encontrada.' })
      }
      if (access.collectionId && row.collectionId !== access.collectionId) {
        return reply.code(403).send({ error: 'Esta chave não alcança a chave que você quer revogar.' })
      }
      await db
        .update(accessKeys)
        .set({ revokedAt: new Date() })
        .where(eq(accessKeys.id, req.params.id))
      // derruba os sockets que estavam abertos com ela
      revokedKeys.add(req.params.id)
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
      return reply.code(403).send({ error: 'Esta chave é somente leitura.' })
    }

    for (const kind of KINDS) {
      for (const entity of changes[`${kind}s`] ?? []) {
        if (!entity?.id || !entity.updatedAt) continue
        const rootCollectionId = rootOf(kind, entity)
        // Uma chave de collection não escreve fora da própria collection.
        if (!inScope(access, rootCollectionId)) continue
        const updatedAt = new Date(entity.updatedAt)
        // Last-write-wins: só grava se for mais novo que o que está no servidor.
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

    // Devolve tudo que mudou no servidor desde o último sync do cliente,
    // recortado pelo escopo da chave.
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

    // Só notifica a sala se este push realmente trouxe mudanças —
    // senão cada pull dispara outro pull e a sala entra em loop.
    if (pushed) broadcast(projectId, access.keyId)

    return { now: now.toISOString(), changes: out, deletes: tombstones }
  })

  // ---------- websocket ----------
  // Precisa estar num escopo registrado DEPOIS do plugin websocket carregar,
  // senão a rota vira um GET comum e o handshake falha com 500.
  app.register(async (scope) => {
    scope.get(
      '/sync/ws',
      { websocket: true },
      async (socket, req) => {
        // A chave vai no subprotocolo, não na query: query entra em log de acesso.
        const offered = req.headers['sec-websocket-protocol']
        const raw =
          (typeof offered === 'string' ? offered.split(',').map((v) => v.trim()) : [])
            .find((v) => v.startsWith(KEY_PREFIX)) ?? bearerOf(req)
        const access = await resolveKey(raw)
        if (!access) {
          socket.close(4001, 'chave inválida')
          return
        }
        const room = rooms.get(access.projectId) ?? new Set()
        room.add(socket)
        rooms.set(access.projectId, room)
        socket.on('close', () => room.delete(socket))
      },
    )
  })

  // ---------- proxy CORS para a versão web ----------

  app.post<{ Body: { url: string; method: string; headers: Record<string, string>; body: string | null } }>(
    '/proxy',
    { onRequest: [requireKey] },
    async (req, reply) => {
      const { url, method, headers = {}, body = null } = req.body ?? {}
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return reply.code(400).send({ error: 'URL inválida.' })
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return reply.code(400).send({ error: 'Só http/https são suportados.' })
      }
      // Guarda mínima contra SSRF no MVP: bloqueia metadata de cloud e loopback.
      if (['169.254.169.254', 'metadata.google.internal', 'localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(parsed.hostname)) {
        return reply.code(400).send({ error: 'Host não permitido pelo proxy.' })
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
          error: err instanceof Error ? err.message : 'Falha ao alcançar o destino.',
        })
      }
    },
  )

  app.get('/health', async () => ({ ok: true }))

  return app
}
