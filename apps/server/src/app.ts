import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import websocket from '@fastify/websocket'
import type { WebSocket } from '@fastify/websocket'
import bcrypt from 'bcryptjs'
import { and, eq, gt, sql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import type { Db } from './db/index.js'
import { entities, invites, users, workspaceMembers, workspaces } from './db/schema.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string }
    user: { sub: string; email: string }
  }
}

export interface AppOptions {
  db: Db
  jwtSecret: string
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

export function buildApp({ db, jwtSecret }: AppOptions) {
  const app = Fastify({ logger: false })

  app.register(cors, { origin: true })
  app.register(jwt, { secret: jwtSecret })
  app.register(websocket)

  // Salas de WebSocket por workspace, para notificar mudanças em tempo real.
  const rooms = new Map<string, Set<WebSocket>>()
  const broadcast = (workspaceId: string, except?: string) => {
    const room = rooms.get(workspaceId)
    if (!room) return
    const msg = JSON.stringify({ type: 'changed', workspaceId, by: except ?? null })
    for (const socket of room) {
      if (socket.readyState === socket.OPEN) socket.send(msg)
    }
  }

  const requireAuth = async (req: { jwtVerify: () => Promise<unknown> }, reply: { code: (c: number) => { send: (b: unknown) => void } }) => {
    try {
      await req.jwtVerify()
    } catch {
      reply.code(401).send({ error: 'Não autenticado.' })
    }
  }

  async function requireMember(userId: string, workspaceId: string) {
    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      )
    return member ?? null
  }

  // ---------- auth ----------

  app.post<{ Body: { email: string; password: string } }>('/auth/register', async (req, reply) => {
    const { email, password } = req.body ?? {}
    if (!email?.includes('@') || !password || password.length < 8) {
      return reply.code(400).send({ error: 'E-mail válido e senha com 8+ caracteres são obrigatórios.' })
    }
    const [existing] = await db.select().from(users).where(eq(users.email, email.toLowerCase()))
    if (existing) return reply.code(409).send({ error: 'Este e-mail já tem conta.' })

    const [user] = await db
      .insert(users)
      .values({ email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10) })
      .returning()
    const token = app.jwt.sign({ sub: user!.id, email: user!.email })
    return { token, email: user!.email }
  })

  app.post<{ Body: { email: string; password: string } }>('/auth/login', async (req, reply) => {
    const { email, password } = req.body ?? {}
    const [user] = await db.select().from(users).where(eq(users.email, (email ?? '').toLowerCase()))
    if (!user || !(await bcrypt.compare(password ?? '', user.passwordHash))) {
      return reply.code(401).send({ error: 'E-mail ou senha incorretos.' })
    }
    const token = app.jwt.sign({ sub: user.id, email: user.email })
    return { token, email: user.email }
  })

  // ---------- workspaces ----------

  app.get('/workspaces', { onRequest: [requireAuth] }, async (req) => {
    const rows = await db
      .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, req.user.sub))
    return { workspaces: rows }
  })

  app.post<{ Body: { name: string } }>(
    '/workspaces',
    { onRequest: [requireAuth] },
    async (req, reply) => {
      const name = req.body?.name?.trim()
      if (!name) return reply.code(400).send({ error: 'Nome do workspace é obrigatório.' })
      const [ws] = await db.insert(workspaces).values({ name }).returning()
      await db
        .insert(workspaceMembers)
        .values({ workspaceId: ws!.id, userId: req.user.sub, role: 'owner' })
      return { id: ws!.id, name: ws!.name }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/workspaces/:id/invites',
    { onRequest: [requireAuth] },
    async (req, reply) => {
      if (!(await requireMember(req.user.sub, req.params.id))) {
        return reply.code(403).send({ error: 'Você não é membro deste workspace.' })
      }
      const code = randomBytes(6).toString('base64url')
      await db.insert(invites).values({ code, workspaceId: req.params.id, createdBy: req.user.sub })
      return { code }
    },
  )

  app.post<{ Params: { code: string } }>(
    '/invites/:code/accept',
    { onRequest: [requireAuth] },
    async (req, reply) => {
      const [invite] = await db.select().from(invites).where(eq(invites.code, req.params.code))
      if (!invite) return reply.code(404).send({ error: 'Convite não encontrado.' })
      await db
        .insert(workspaceMembers)
        .values({ workspaceId: invite.workspaceId, userId: req.user.sub })
        .onConflictDoNothing()
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, invite.workspaceId))
      return { id: ws!.id, name: ws!.name }
    },
  )

  // ---------- sync ----------

  app.post<{ Params: { id: string }; Body: SyncBody }>(
    '/workspaces/:id/sync',
    { onRequest: [requireAuth] },
    async (req, reply) => {
      const workspaceId = req.params.id
      if (!(await requireMember(req.user.sub, workspaceId))) {
        return reply.code(403).send({ error: 'Você não é membro deste workspace.' })
      }
      const { since = null, changes = {}, deletes = {} } = req.body ?? {}
      const now = new Date()

      for (const kind of KINDS) {
        for (const entity of changes[`${kind}s`] ?? []) {
          if (!entity?.id || !entity.updatedAt) continue
          const updatedAt = new Date(entity.updatedAt)
          // Last-write-wins: só grava se for mais novo que o que está no servidor.
          await db
            .insert(entities)
            .values({
              id: entity.id,
              workspaceId,
              kind,
              data: entity,
              updatedAt,
              deleted: false,
              syncedAt: now,
            })
            .onConflictDoUpdate({
              target: [entities.workspaceId, entities.id],
              set: {
                data: entity,
                updatedAt,
                deleted: false,
                syncedAt: now,
              },
              setWhere: sql`${entities.updatedAt} < ${updatedAt}`,
            })
        }
        for (const id of deletes[`${kind}s`] ?? []) {
          await db
            .update(entities)
            .set({ deleted: true, updatedAt: now, syncedAt: now })
            .where(and(eq(entities.workspaceId, workspaceId), eq(entities.id, id)))
        }
      }

      // Devolve tudo que mudou no servidor desde o último sync do cliente.
      const changedRows = await db
        .select()
        .from(entities)
        .where(
          since
            ? and(eq(entities.workspaceId, workspaceId), gt(entities.syncedAt, new Date(since)))
            : eq(entities.workspaceId, workspaceId),
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
      const pushedSomething =
        KINDS.some((kind) => (changes[`${kind}s`]?.length ?? 0) > 0) ||
        KINDS.some((kind) => (deletes[`${kind}s`]?.length ?? 0) > 0)
      if (pushedSomething) broadcast(workspaceId, req.user.sub)

      return { now: now.toISOString(), changes: out, deletes: tombstones }
    },
  )

  // ---------- websocket ----------
  // Precisa estar num escopo registrado DEPOIS do plugin websocket carregar,
  // senão a rota vira um GET comum e o handshake falha com 500.
  app.register(async (scope) => {
    scope.get<{ Params: { id: string }; Querystring: { token?: string } }>(
      '/workspaces/:id/ws',
      { websocket: true },
      async (socket, req) => {
        let userId: string
        try {
          const payload = app.jwt.verify<{ sub: string }>(req.query.token ?? '')
          userId = payload.sub
        } catch {
          socket.close(4001, 'token inválido')
          return
        }
        if (!(await requireMember(userId, req.params.id))) {
          socket.close(4003, 'não é membro')
          return
        }
        const room = rooms.get(req.params.id) ?? new Set()
        room.add(socket)
        rooms.set(req.params.id, room)
        socket.on('close', () => room.delete(socket))
      },
    )
  })

  // ---------- proxy CORS para a versão web ----------

  app.post<{ Body: { url: string; method: string; headers: Record<string, string>; body: string | null } }>(
    '/proxy',
    { onRequest: [requireAuth] },
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
