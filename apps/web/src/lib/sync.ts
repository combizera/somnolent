import { rootCollectionOf, type ApiRequest, type Collection, type Environment } from '@somnolent/core'
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
  const s = useStore.getState()
  const { key, role } = s.connection
  if (!key) return

  if (syncing) {
    queued = true
    return
  }
  syncing = true
  setStatus('syncing')

  try {
    const since = s.lastSyncAt
    const scope = withScope(s.collections)
    const changedOnly = <T extends { updatedAt: string }>(items: T[]) =>
      since ? items.filter((it) => it.updatedAt > since) : items

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
            collections: changedOnly(s.collections).map(scope.collection),
            requests: changedOnly(s.requests).map(scope.request),
            environments: changedOnly(s.environments).map(stripSecrets),
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
