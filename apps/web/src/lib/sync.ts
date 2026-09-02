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
    setStatus('ok')
  } catch (err) {
    console.error('sync falhou:', err)
    setStatus('error')
  } finally {
    syncing = false
    if (queued) {
      queued = false
      void syncNow()
    }
  }
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

  // Polling de segurança caso o WebSocket caia sem avisar.
  setInterval(() => {
    if (useStore.getState().connection.key) void syncNow()
  }, 20_000)

  // Sync inicial se a chave persistida ainda estiver lá.
  const s = useStore.getState()
  if (s.connection.key) {
    connectWs(s.connection.key)
    void syncNow()
  }
}
