import type { Environment } from '@somnolent/core'
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
  const { token } = s.auth
  const { workspaceId } = s.server
  if (!token || !workspaceId) return

  if (syncing) {
    queued = true
    return
  }
  syncing = true
  setStatus('syncing')

  try {
    const since = s.lastSyncAt
    const changedOnly = <T extends { updatedAt: string }>(items: T[]) =>
      since ? items.filter((it) => it.updatedAt > since) : items

    const pushedDeletes: PendingDeletes = {
      collections: [...s.pendingDeletes.collections],
      requests: [...s.pendingDeletes.requests],
      environments: [...s.pendingDeletes.environments],
    }

    const result = await api.sync(token, workspaceId, {
      since,
      changes: {
        collections: changedOnly(s.collections),
        requests: changedOnly(s.requests),
        environments: changedOnly(s.environments).map(stripSecrets),
      },
      deletes: { ...pushedDeletes },
    })

    const store = useStore.getState()
    store.applyRemote(result.changes as RemoteChanges, result.deletes as Partial<PendingDeletes>)
    store.clearPendingDeletes(pushedDeletes)
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

function connectWs(workspaceId: string, token: string) {
  const key = `${workspaceId}:${token}`
  if (wsKey === key && ws && ws.readyState <= WebSocket.OPEN) return
  ws?.close()
  wsKey = key
  ws = new WebSocket(wsUrl(workspaceId, token))
  ws.onmessage = () => void syncNow()
  ws.onclose = () => {
    // Reconecta se ainda estamos no mesmo workspace.
    setTimeout(() => {
      const s = useStore.getState()
      if (s.auth.token && s.server.workspaceId && wsKey === `${s.server.workspaceId}:${s.auth.token}`) {
        wsKey = ''
        connectWs(s.server.workspaceId, s.auth.token)
      }
    }, 3000)
  }
}

/** Liga o sync contínuo: push debounced a cada mudança + WS + polling de segurança. */
export function startSyncEngine() {
  if (started) return
  started = true

  useStore.subscribe((state, prev) => {
    const connected = state.auth.token && state.server.workspaceId
    if (!connected) {
      ws?.close()
      ws = null
      wsKey = ''
      setStatus('off')
      return
    }
    connectWs(state.server.workspaceId!, state.auth.token!)

    const dataChanged =
      state.collections !== prev.collections ||
      state.requests !== prev.requests ||
      state.environments !== prev.environments ||
      state.pendingDeletes !== prev.pendingDeletes
    const justConnected = state.server.workspaceId !== prev.server.workspaceId

    if (dataChanged || justConnected) {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void syncNow(), 1200)
    }
  })

  // Polling de segurança caso o WebSocket caia sem avisar.
  setInterval(() => {
    const s = useStore.getState()
    if (s.auth.token && s.server.workspaceId) void syncNow()
  }, 20_000)

  // Sync inicial se a sessão persistida já estava conectada.
  const s = useStore.getState()
  if (s.auth.token && s.server.workspaceId) {
    connectWs(s.server.workspaceId, s.auth.token)
    void syncNow()
  }
}
