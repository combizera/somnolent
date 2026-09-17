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

/** The server scopes a collection key by each row's `rootCollectionId`, and only
 *  the client knows the hierarchy — unscoped rows would be invisible to that key. */
export function withScope(collections: Collection[]) {
  const rootOf = (id: string | null) => rootCollectionOf(collections, id)?.id ?? null
  return {
    collection: (c: Collection) => ({ ...c, rootCollectionId: rootOf(c.id) }),
    request: (r: ApiRequest) => ({ ...r, rootCollectionId: rootOf(r.collectionId) }),
  }
}

/** Secret variable values never leave this machine. */
function stripSecrets(env: Environment): Environment {
  return {
    ...env,
    variables: env.variables.map((v) => (v.secret ? { ...v, value: '' } : v)),
  }
}

let syncing = false
let queued = false
/** Consecutive failures — feeds the polling backoff. Resets on the first success. */
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
    // Connection saved before `projectId` existed: bind it now, or there is no
    // way to tell which local project matches the server's.
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

    // Push only the connected project: without this cut, every other local
    // project would leak to whoever holds this one's key.
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

    // A read key pushes nothing: the server would answer 403 and the status
    // would sit in permanent error.
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
    // Only the first error of a run reaches the console: with the API down,
    // logging every attempt buried everything else.
    if (failures === 0) console.error('sync failed:', err)
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

/** Sync is reactive (debounced push plus WebSocket); this polling only covers a
 *  socket that dies silently, and backs off so a dead API is not hammered. */
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
  // the key goes in the subprotocol, not the query: queries land in access logs
  ws = new WebSocket(wsUrl(), [key])
  ws.onmessage = () => void syncNow()
  ws.onclose = () => {
    // Reconnect while the key is still the same (revoking sets it to null).
    setTimeout(() => {
      const s = useStore.getState()
      if (s.connection.key && wsKey === s.connection.key) {
        wsKey = ''
        connectWs(s.connection.key)
      }
    }, 3000)
  }
}

/** Starts continuous sync: debounced push on change, WebSocket, and safety polling. */
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

  // Initial sync if the persisted key is still there.
  const s = useStore.getState()
  if (s.connection.key) {
    connectWs(s.connection.key)
    void syncNow()
  }
}
