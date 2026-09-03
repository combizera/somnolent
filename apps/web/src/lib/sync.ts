import {
  collectionIdsOfProject,
  rootCollectionOf,
  type ApiRequest,
  type Collection,
  type Environment,
} from '@somnolent/core'
import { api, wsUrl } from './api'
import { useStore, type PendingDeletes, type RemoteChanges } from '../store'

export type SyncStatus = 'off' | 'syncing' | 'ok' | 'error'

let status: SyncStatus = 'off'
const listeners = new Set<(s: SyncStatus) => void>()
function setStatus(s: SyncStatus) {
  status = s
  listeners.forEach((l) => l(s))
}
export function onSyncStatus(l: (s: SyncStatus) => void) {
  listeners.add(l)
  l(status)
  return () => listeners.delete(l)
}

/**
 * O servidor filtra o escopo de uma chave de collection pelo
 * `rootCollectionId` de cada linha — e quem sabe a hierarquia é o cliente.
 * Sem esta anotação, requests e subpastas subiriam sem escopo e ficariam
 * invisíveis pra quem entrou com uma chave de collection.
 */
export function withScope(collections: Collection[]) {
  const rootOf = (id: string | null) => rootCollectionOf(collections, id)?.id ?? null
  return {
    collection: (c: Collection) => ({ ...c, rootCollectionId: rootOf(c.id) }),
    request: (r: ApiRequest) => ({ ...r, rootCollectionId: rootOf(r.collectionId) }),
  }
}

/** Valores de variáveis secretas nunca saem desta máquina. */
function stripSecrets(env: Environment): Environment {
  return {
    ...env,
    variables: env.variables.map((v) => (v.secret ? { ...v, value: '' } : v)),
  }
}

let syncing = false
let queued = false
/** Falhas seguidas — alimenta o recuo do polling. Zera no primeiro sucesso. */
let failures = 0

export async function syncNow(): Promise<void> {
  let s = useStore.getState()
  const { key, role } = s.connection
  if (!key) return

  if (syncing) {
    queued = true
    return
  }
  syncing = true
  setStatus('syncing')

  try {
    // Conexão salva antes de o `projectId` existir: amarra agora, senão não há
    // como saber qual project local corresponde ao do servidor.
    if (!s.connection.projectId) {
      const info = await api.me(key)
      useStore.getState().adoptRemoteProject(info.project)
      s = useStore.getState()
    }
    const projectId = s.connection.projectId!

    const since = s.lastSyncAt
    const scope = withScope(s.collections)
    const changedOnly = <T extends { updatedAt: string }>(items: T[]) =>
      since ? items.filter((it) => it.updatedAt > since) : items

    // Sobe só o project conectado. Os outros projects locais são desta máquina:
    // sem este recorte, todos vazariam pra quem tem a chave deste.
    const inProject = collectionIdsOfProject(s.collections, projectId)
    const mine = {
      collections: s.collections.filter((c) => c.projectId === projectId),
      requests: s.requests.filter((r) => r.projectId === projectId),
      environments: s.environments.filter((e) => inProject.has(e.collectionId)),
    }

    const pushedDeletes: PendingDeletes = {
      collections: [...s.pendingDeletes.collections],
      requests: [...s.pendingDeletes.requests],
      environments: [...s.pendingDeletes.environments],
    }

    // Chave de leitura não empurra nada: o servidor recusaria com 403 e o
    // status ficaria em erro permanente.
    const readOnly = role === 'read'
    const result = await api.sync(key, {
      since,
      changes: readOnly
        ? {}
        : {
            collections: changedOnly(mine.collections).map(scope.collection),
            requests: changedOnly(mine.requests).map(scope.request),
            environments: changedOnly(mine.environments).map(stripSecrets),
          },
      deletes: readOnly ? {} : { ...pushedDeletes },
    })

    const store = useStore.getState()
    store.applyRemote(result.changes as RemoteChanges, result.deletes as Partial<PendingDeletes>)
    if (!readOnly) store.clearPendingDeletes(pushedDeletes)
    store.setLastSyncAt(result.now)
    failures = 0
    setStatus('ok')
  } catch (err) {
    // Só o primeiro erro da sequência vai pro console: com a API fora do ar,
    // logar cada tentativa enterrava o resto das mensagens.
    if (failures === 0) console.error('sync falhou:', err)
    failures++
    setStatus('error')
  } finally {
    syncing = false
    if (queued) {
      queued = false
      void syncNow()
    }
  }
}

/**
 * O caminho normal do sync é reativo: mudança local dispara push (debounce de
 * 1200ms) e o WebSocket avisa de mudança remota. O polling abaixo existe só pro
 * caso do socket morrer calado — readyState continua OPEN e nada mais chega.
 *
 * Com o socket aberto ele é raro (5 min). Sem socket, cai pros 20s e recua
 * exponencialmente a cada falha, até 5 min: contra uma API fora do ar, insistir
 * de 20 em 20 segundos pra sempre só gasta bateria e enche o console.
 */
const POLL_WS_OPEN_MS = 5 * 60_000
const POLL_WS_DOWN_MS = 20_000
const POLL_MAX_MS = 5 * 60_000

let pollTimer: ReturnType<typeof setTimeout> | undefined

function pollDelay(): number {
  if (ws?.readyState === WebSocket.OPEN && failures === 0) return POLL_WS_OPEN_MS
  const base = POLL_WS_DOWN_MS * 2 ** Math.min(failures, 10)
  return Math.min(failures === 0 ? POLL_WS_DOWN_MS : base, POLL_MAX_MS)
}

function schedulePoll() {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(() => {
    if (useStore.getState().connection.key) void syncNow()
    schedulePoll()
  }, pollDelay())
}

let started = false
let ws: WebSocket | null = null
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let wsKey = ''

function connectWs(key: string) {
  if (wsKey === key && ws && ws.readyState <= WebSocket.OPEN) return
  ws?.close()
  wsKey = key
  // a chave vai no subprotocolo, não na query: query entra em log de acesso
  ws = new WebSocket(wsUrl(), [key])
  ws.onmessage = () => void syncNow()
  ws.onclose = () => {
    // Reconecta se a chave ainda é a mesma (revogar troca isso pra null).
    setTimeout(() => {
      const s = useStore.getState()
      if (s.connection.key && wsKey === s.connection.key) {
        wsKey = ''
        connectWs(s.connection.key)
      }
    }, 3000)
  }
}

/** Liga o sync contínuo: push debounced a cada mudança + WS + polling de segurança. */
export function startSyncEngine() {
  if (started) return
  started = true

  useStore.subscribe((state, prev) => {
    const key = state.connection.key
    if (!key) {
      ws?.close()
      ws = null
      wsKey = ''
      setStatus('off')
      return
    }
    connectWs(key)

    const dataChanged =
      state.collections !== prev.collections ||
      state.requests !== prev.requests ||
      state.environments !== prev.environments ||
      state.pendingDeletes !== prev.pendingDeletes
    const justConnected = state.connection.key !== prev.connection.key

    if (dataChanged || justConnected) {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void syncNow(), 1200)
    }
  })

  schedulePoll()

  // Sync inicial se a chave persistida ainda estiver lá.
  const s = useStore.getState()
  if (s.connection.key) {
    connectWs(s.connection.key)
    void syncNow()
  }
}
