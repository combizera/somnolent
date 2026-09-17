import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { migrateWorkspace } from './lib/migrate'
import { collectionIdsOfProject, rootCollectionOf, uniqueEnvName } from '@somnolent/core'
import type {
  ApiRequest,
  Collection,
  Environment,
  HttpMethod,
  Project,
} from '@somnolent/core'

export interface HistoryEntry {
  id: string
  requestId: string
  method: HttpMethod
  url: string
  status: number
  statusText: string
  timeMs: number
  sizeBytes: number
  headers: { key: string; value: string }[]
  body: string
  at: string
}

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

const MAX_HISTORY_PER_REQUEST = 20
const MAX_HISTORY_BODY = 100_000

/** Tab cap is PER collection, not global: the strip shows one collection at a
 *  time, so one cap must not eat another collection's tabs. */
export const MAX_TABS_PER_COLLECTION = 10

/** Just enough to tell which tabs show, and under which collection. */
interface TabContext {
  collections: Collection[]
  requests: ApiRequest[]
  selectedRequestId: string | null
  openCollectionId: string | null
}

/** Root collection of a request — how the strip slices its tabs. `null` covers
 *  both a vanished request and one outside any collection. */
function tabScope(
  collections: Collection[],
  requests: ApiRequest[],
  requestId: string,
): string | null {
  const request = requests.find((r) => r.id === requestId)
  if (!request) return null
  return rootCollectionOf(collections, request.collectionId)?.id ?? null
}

/** Same rule as the variable context on purpose: strip and active environment
 *  must agree on where the person is, or a tab click would swap one alone. */
function openScope(s: TabContext): string | null {
  const selected = s.requests.find((r) => r.id === s.selectedRequestId)
  return rootCollectionOf(s.collections, selected?.collectionId ?? s.openCollectionId)?.id ?? null
}

/** Adds the tab at the right. Over the cap, the oldest tab OF THE SAME
 *  collection leaves: the strip never reorders itself, and reopening is one click. */
function withTab(
  tabs: string[],
  collections: Collection[],
  requests: ApiRequest[],
  requestId: string,
): string[] {
  if (tabs.includes(requestId)) return tabs
  const scope = tabScope(collections, requests, requestId)
  const next = [...tabs, requestId]
  const sameScope = next.filter((id) => tabScope(collections, requests, id) === scope)
  const excess = sameScope.length - MAX_TABS_PER_COLLECTION
  if (excess <= 0) return next
  const evicted = new Set(sameScope.slice(0, excess))
  return next.filter((id) => !evicted.has(id))
}

/** Sidebar order lives in `sortOrder`, not in array order: sync sends each entity
 *  on its own, so the position has to travel with it. */
export const bySortOrder = <T extends { sortOrder: number }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder

const nextSort = (items: { sortOrder: number }[]) =>
  items.reduce((max, it) => Math.max(max, it.sortOrder), -1) + 1

function seed() {
  const project: Project = {
    id: uid(),
    name: 'Personal',
    sortOrder: 0,
    version: 1,
    updatedAt: now(),
  }
  // Environments belong to a collection, so the seed needs one.
  const collection: Collection = {
    id: uid(),
    projectId: project.id,
    parentId: null,
    name: 'Examples',
    sortOrder: 0,
    version: 1,
    updatedAt: now(),
  }
  const base: Environment = {
    id: uid(),
    collectionId: collection.id,
    name: 'Base',
    isBase: true,
    variables: [{ key: 'page_size', value: '20', secret: false, enabled: true }],
    sortOrder: 0,
    version: 1,
    updatedAt: now(),
  }
  const staging: Environment = {
    id: uid(),
    collectionId: collection.id,
    name: 'staging',
    isBase: false,
    color: '#f59e0b',
    variables: [
      { key: 'base_url', value: 'https://httpbin.org', secret: false, enabled: true },
      { key: 'token', value: 'stg-token-123', secret: true, enabled: true },
    ],
    sortOrder: 1,
    version: 1,
    updatedAt: now(),
  }
  const prod: Environment = {
    id: uid(),
    collectionId: collection.id,
    name: 'prod',
    isBase: false,
    color: '#ef4444',
    variables: [
      { key: 'base_url', value: 'https://httpbin.org', secret: false, enabled: true },
      { key: 'token', value: 'prd-token-789', secret: true, enabled: true },
    ],
    sortOrder: 2,
    version: 1,
    updatedAt: now(),
  }
  const request: ApiRequest = {
    id: uid(),
    projectId: project.id,
    collectionId: collection.id,
    name: 'Example — GET with vars',
    method: 'GET',
    url: '{{ base_url }}/get',
    headers: [
      { id: uid(), key: 'Authorization', value: 'Bearer {{ token }}', enabled: true },
    ],
    queryParams: [
      { id: uid(), key: 'limit', value: '{{ page_size }}', enabled: true },
    ],
    body: null,
    bodyType: 'none',
    sortOrder: 0,
    version: 1,
    updatedAt: now(),
  }
  return {
    projects: [project],
    openProjectId: project.id,
    collections: [collection],
    environments: [base, staging, prod],
    requests: [request],
    activeEnvByCollection: { [collection.id]: staging.id },
    selectedRequestId: request.id,
  }
}

export interface Connection {
  key: string | null
  scope: 'project' | 'collection' | null
  role: 'write' | 'read' | null
  label: string | null
  /** The project id ON THE SERVER — and of the local project too, once bound. */
  projectId: string | null
  projectName: string | null
  collectionId: string | null
}

/** Every action that touches `connection` goes through here, or the keyring
 *  drifts and switching project throws away a live key. */
const remember = (keyring: Record<string, Connection>, connection: Connection) =>
  connection.key && connection.projectId
    ? { ...keyring, [connection.projectId]: connection }
    : keyring

const NO_CONNECTION: Connection = {
  key: null,
  scope: null,
  role: null,
  label: null,
  projectId: null,
  projectName: null,
  collectionId: null,
}

export interface RemoteChanges {
  collections?: Collection[]
  requests?: ApiRequest[]
  environments?: Environment[]
}

export interface PendingDeletes {
  collections: string[]
  requests: string[]
  environments: string[]
}

interface AppState {
  projects: Project[]
  /** Project open in the header picker — a local choice, never synced. */
  openProjectId: string | null
  collections: Collection[]
  requests: ApiRequest[]
  environments: Environment[]
  /** Active environment per collection, so prod here and local there is possible.
   *  A local choice, never synced. */
  activeEnvByCollection: Record<string, string | null>
  selectedRequestId: string | null
  /** Collection open in the sidebar (two-level navigation, like Insomnia).
   *  A local choice of whoever is navigating: never synced. */
  openCollectionId: string | null
  /** We store the OPEN folders, not the closed ones, so a brand-new folder starts
   *  collapsed. Array, not Set: persist serializes to JSON. */
  expandedFolders: string[]
  /** Requests open in the tab strip, in position order, newest at the right.
   *  A local navigation choice, never synced. Array, not Set: persist uses JSON. */
  openTabs: string[]
  history: Record<string, HistoryEntry[]>

  /** Sync connection. There are no accounts: the key is the credential, and what
   *  it opens comes from the server at /me. */
  connection: Connection
  /** One key per project this machine has opened: what makes sharing repeatable
   *  instead of a one-shot moment nobody wrote down. */
  keyring: Record<string, Connection>
  lastSyncAt: string | null
  pendingDeletes: PendingDeletes

  connect: (key: string, info: Omit<Connection, 'key'>) => void
  disconnect: () => void
  setLastSyncAt: (at: string) => void
  clearPendingDeletes: (pushed: PendingDeletes) => void
  /** Binds the local project to the server's id. Otherwise rows go up with a
   *  `projectId` only this machine knows, and the next person sees an empty sidebar. */
  adoptRemoteProject: (project: { id: string; name: string }) => void
  /** Joins someone else's project: creates it locally with the server's id and
   *  clears only what is inside it — the first pull brings everything back. */
  enterRemoteProject: (project: { id: string; name: string }) => void
  applyRemote: (changes: RemoteChanges, deletes: Partial<PendingDeletes>) => void

  addProject: (name: string) => string
  renameProject: (id: string, name: string) => void
  deleteProject: (id: string) => void
  openProject: (id: string) => void

  addCollection: (name: string) => string
  /** Enters a collection (or goes back to the list, with null). */
  openCollection: (id: string | null) => void
  toggleFolder: (id: string) => void
  expandFolders: (ids: string[]) => void
  collapseFolders: (ids: string[]) => void
  addSubCollection: (parentId: string, name: string) => void
  renameCollection: (id: string, name: string) => void
  deleteCollection: (id: string) => void

  addRequest: (collectionId: string | null) => string
  updateRequest: (id: string, patch: Partial<ApiRequest>) => void
  deleteRequest: (id: string) => void
  duplicateRequest: (id: string) => void
  selectRequest: (id: string | null) => void
  /** Opens (or brings forward) a request's tab and selects it. */
  openTab: (id: string) => void
  closeTab: (id: string) => void
  /** Closes the other tabs OF THE SAME collection and leaves this one active. */
  closeOtherTabs: (id: string) => void
  /** Closes every tab of the collection in context. */
  closeAllTabs: () => void
  /** Moves a request into a folder (or the root) at the given position. */
  moveRequest: (id: string, collectionId: string | null, index: number) => void
  /** Reorders a folder among its siblings. */
  moveCollection: (id: string, index: number) => void
  importData: (data: {
    collections?: Collection[]
    requests?: ApiRequest[]
    environments?: Environment[]
  }) => void

  addEnvironment: (collectionId: string) => string
  /** Reorders environments in the manager list (the base one included). */
  moveEnvironment: (id: string, index: number) => void
  updateEnvironment: (id: string, patch: Partial<Environment>) => void
  deleteEnvironment: (id: string) => void
  setActiveEnv: (collectionId: string, envId: string | null) => void

  pushHistory: (entry: Omit<HistoryEntry, 'id' | 'at'>) => void
  clearHistory: (requestId: string) => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      history: {},
      openCollectionId: null,
      expandedFolders: [],
      openTabs: [],
      ...seed(),

      connection: NO_CONNECTION,
      keyring: {},
      lastSyncAt: null,
      pendingDeletes: { collections: [], requests: [], environments: [] },

      connect: (key, info) =>
        set((s) => {
          const connection: Connection = { key, ...info }
          return { connection, keyring: remember(s.keyring, connection), lastSyncAt: null }
        }),

      // "Disconnect this machine" has to forget the key too, or switching away
      // and back would reconnect on its own.
      disconnect: () =>
        set((s) => {
          const keyring = { ...s.keyring }
          if (s.connection.projectId) delete keyring[s.connection.projectId]
          return { connection: NO_CONNECTION, keyring, lastSyncAt: null }
        }),

      setLastSyncAt: (at) => set({ lastSyncAt: at }),

      clearPendingDeletes: (pushed) =>
        set((s) => ({
          pendingDeletes: {
            collections: s.pendingDeletes.collections.filter(
              (id) => !pushed.collections.includes(id),
            ),
            requests: s.pendingDeletes.requests.filter((id) => !pushed.requests.includes(id)),
            environments: s.pendingDeletes.environments.filter(
              (id) => !pushed.environments.includes(id),
            ),
          },
        })),

      adoptRemoteProject: ({ id, name }) =>
        set((s) => {
          const at = now()
          const from = s.openProjectId
          const connection = { ...s.connection, projectId: id, projectName: name }
          // The legacy reconnect also runs this path without going through
          // `connect`; not writing here would lose the live key.
          const keyring = remember(s.keyring, connection)
          if (!from || from === id) {
            // Already bound, or no project was open: just make sure it exists
            // in the list under the server's name.
            return {
              connection,
              keyring,
              openProjectId: id,
              projects: s.projects.some((p) => p.id === id)
                ? s.projects.map((p) =>
                    p.id === id ? { ...p, name, version: p.version + 1, updatedAt: at } : p,
                  )
                : [
                    ...s.projects,
                    { id, name, sortOrder: nextSort(s.projects), version: 1, updatedAt: at },
                  ],
            }
          }
          // Fresh `updatedAt` on everything re-tagged: push only sends what
          // changed since the last sync, and here the `projectId` changed.
          return {
            connection,
            keyring,
            openProjectId: id,
            projects: s.projects.map((p) =>
              p.id === from ? { ...p, id, name, version: p.version + 1, updatedAt: at } : p,
            ),
            collections: s.collections.map((c) =>
              c.projectId === from
                ? { ...c, projectId: id, version: c.version + 1, updatedAt: at }
                : c,
            ),
            requests: s.requests.map((r) =>
              r.projectId === from
                ? { ...r, projectId: id, version: r.version + 1, updatedAt: at }
                : r,
            ),
          }
        }),

      enterRemoteProject: ({ id, name }) =>
        set((s) => {
          const mine = collectionIdsOfProject(s.collections, id)
          const requests = s.requests.filter((r) => r.projectId !== id)
          const kept = new Set(requests.map((r) => r.id))
          const connection = { ...s.connection, projectId: id, projectName: name }
          return {
            connection,
            keyring: remember(s.keyring, connection),
            openProjectId: id,
            projects: s.projects.some((p) => p.id === id)
              ? s.projects.map((p) => (p.id === id ? { ...p, name } : p))
              : [
                  ...s.projects,
                  { id, name, sortOrder: nextSort(s.projects), version: 1, updatedAt: now() },
                ],
            // Clear only the connected project — the other local projects do
            // not sync and have no reason to be wiped.
            collections: s.collections.filter((c) => c.projectId !== id),
            requests,
            environments: s.environments.filter((e) => !mine.has(e.collectionId)),
            activeEnvByCollection: Object.fromEntries(
              Object.entries(s.activeEnvByCollection).filter(([colId]) => !mine.has(colId)),
            ),
            history: Object.fromEntries(
              Object.entries(s.history).filter(([reqId]) => kept.has(reqId)),
            ),
            selectedRequestId: null,
            openCollectionId: null,
            openTabs: [],
            pendingDeletes: { collections: [], requests: [], environments: [] },
          }
        }),

      applyRemote: (changes, deletes) =>
        set((s) => {
          // Keep the array reference when nothing changes, or the sync engine
          // reads applyRemote itself as an edit and loops.
          const merge = <T extends { id: string; updatedAt: string }>(
            local: T[],
            incoming: T[] | undefined,
            removed: string[] | undefined,
            mergeOne?: (localItem: T | undefined, remote: T) => T,
          ): T[] => {
            let changed = false
            let out = local
            if (removed?.length && local.some((it) => removed.includes(it.id))) {
              out = local.filter((it) => !removed.includes(it.id))
              changed = true
            }
            for (const remote of incoming ?? []) {
              const idx = out.findIndex((it) => it.id === remote.id)
              const localItem = idx >= 0 ? out[idx] : undefined
              if (localItem && localItem.updatedAt >= remote.updatedAt) continue
              const next = mergeOne ? mergeOne(localItem, remote) : remote
              if (!changed) {
                out = [...out]
                changed = true
              }
              if (idx >= 0) out[idx] = next
              else out.push(next)
            }
            return out
          }

          // Secret variables arrive empty from the server: keep this machine's
          // local value, matched by key.
          const mergeEnv = (local: Environment | undefined, remote: Environment): Environment => ({
            ...remote,
            variables: remote.variables.map((v) => {
              if (!v.secret || v.value !== '') return v
              const mine = local?.variables.find((lv) => lv.key === v.key)
              return mine ? { ...v, value: mine.value } : v
            }),
          })

          // Everything incoming belongs to the connected project; re-tagging
          // guards against rows an older client pushed with its own id.
          const projectId = s.connection.projectId
          const tag = <T extends { projectId: string }>(items: T[] | undefined) =>
            projectId
              ? items?.map((it) => (it.projectId === projectId ? it : { ...it, projectId }))
              : items

          const requests = merge(s.requests, tag(changes.requests), deletes.requests)
          const environments = merge(s.environments, changes.environments, deletes.environments, mergeEnv)

          return {
            collections: merge(s.collections, tag(changes.collections), deletes.collections),
            requests,
            environments,
            selectedRequestId: requests.some((r) => r.id === s.selectedRequestId)
              ? s.selectedRequestId
              : null,
            openTabs: s.openTabs.filter((id) => requests.some((r) => r.id === id)),
            // an env gone on the remote cannot stay active in any collection
            activeEnvByCollection: Object.fromEntries(
              Object.entries(s.activeEnvByCollection).map(([colId, envId]) => [
                colId,
                environments.some((e) => e.id === envId) ? envId : null,
              ]),
            ),
          }
        }),

      addProject: (name) => {
        const id = uid()
        set((s) => ({
          projects: [
            ...s.projects,
            { id, name, sortOrder: nextSort(s.projects), version: 1, updatedAt: now() },
          ],
        }))
        return id
      },

      renameProject: (id, name) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, name, version: p.version + 1, updatedAt: now() } : p,
          ),
        })),

      /** Deleting a project takes its collections (and whatever hangs off them). */
      deleteProject: (id) =>
        set((s) => {
          if (s.projects.length <= 1) return s // one project always remains
          const colIds = new Set(s.collections.filter((c) => c.projectId === id).map((c) => c.id))
          const reqIds = s.requests
            .filter((r) => r.projectId === id || (r.collectionId && colIds.has(r.collectionId)))
            .map((r) => r.id)
          const envIds = s.environments
            .filter((e) => colIds.has(e.collectionId))
            .map((e) => e.id)
          const projects = s.projects.filter((p) => p.id !== id)
          const keyring = { ...s.keyring }
          delete keyring[id]
          const nextOpen = s.openProjectId === id ? (projects[0]?.id ?? null) : s.openProjectId
          // Deleted the connected project: the connection becomes the one of
          // whatever project stayed open, or none.
          const nextConnection = (nextOpen && keyring[nextOpen]) || NO_CONNECTION
          return {
            projects,
            keyring,
            connection: nextConnection,
            // `lastSyncAt` is per connection: a new connection means the next
            // sync must be a full one.
            lastSyncAt: nextConnection.key === s.connection.key ? s.lastSyncAt : null,
            collections: s.collections.filter((c) => !colIds.has(c.id)),
            requests: s.requests.filter((r) => !reqIds.includes(r.id)),
            environments: s.environments.filter((e) => !envIds.includes(e.id)),
            openProjectId: nextOpen,
            openCollectionId: colIds.has(s.openCollectionId ?? '') ? null : s.openCollectionId,
            selectedRequestId: reqIds.includes(s.selectedRequestId ?? '')
              ? null
              : s.selectedRequestId,
            openTabs: s.openTabs.filter((id) => !reqIds.includes(id)),
            pendingDeletes: {
              collections: [...s.pendingDeletes.collections, ...colIds],
              requests: [...s.pendingDeletes.requests, ...reqIds],
              environments: [...s.pendingDeletes.environments, ...envIds],
            },
          }
        }),

      // Switching project switches the connection: the MVP syncs one project
      // per machine, and each key lives in the keyring.
      openProject: (id) =>
        set((s) => {
          const saved = s.keyring[id] ?? NO_CONNECTION
          if (saved.key === s.connection.key) {
            return { openProjectId: id, openCollectionId: null }
          }
          return {
            openProjectId: id,
            openCollectionId: null,
            connection: saved,
            // `lastSyncAt` is per connection: keeping it would make the new
            // project pull only what changed after another project's sync.
            lastSyncAt: null,
          }
        }),

      toggleFolder: (id) =>
        set((s) => ({
          expandedFolders: s.expandedFolders.includes(id)
            ? s.expandedFolders.filter((it) => it !== id)
            : [...s.expandedFolders, id],
        })),

      expandFolders: (ids) =>
        set((s) => ({ expandedFolders: [...new Set([...s.expandedFolders, ...ids])] })),

      collapseFolders: (ids) =>
        set((s) => ({ expandedFolders: s.expandedFolders.filter((id) => !ids.includes(id)) })),

      addCollection: (name) => {
        const id = uid()
        set((s) => ({
          collections: [
            ...s.collections,
            {
              id,
              projectId: s.openProjectId ?? s.projects[0]!.id,
              parentId: null,
              name,
              sortOrder: nextSort(s.collections.filter((c) => c.parentId === null)),
              version: 1,
              updatedAt: now(),
            },
          ],
        }))
        return id
      },

      openCollection: (id) => set({ openCollectionId: id }),

      addSubCollection: (parentId, name) =>
        set((s) => ({
          collections: [
            ...s.collections,
            {
              id: uid(),
              projectId:
                s.collections.find((c) => c.id === parentId)?.projectId ??
                s.openProjectId ??
                s.projects[0]!.id,
              parentId,
              name,
              sortOrder: nextSort(s.collections.filter((c) => c.parentId === parentId)),
              version: 1,
              updatedAt: now(),
            },
          ],
        })),

      renameCollection: (id, name) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === id ? { ...c, name, version: c.version + 1, updatedAt: now() } : c,
          ),
        })),

      deleteCollection: (id) =>
        set((s) => {
          // Collect all descendant collection IDs (BFS)
          const allColIds = new Set<string>()
          const queue = [id]
          while (queue.length > 0) {
            const cur = queue.shift()!
            allColIds.add(cur)
            s.collections.filter((c) => c.parentId === cur).forEach((c) => queue.push(c.id))
          }
          const doomed = s.requests
            .filter((r) => r.collectionId !== null && allColIds.has(r.collectionId))
            .map((r) => r.id)
          // an environment belongs to its collection, so deleting one deletes its envs
          const doomedEnvs = s.environments
            .filter((e) => allColIds.has(e.collectionId))
            .map((e) => e.id)
          return {
            collections: s.collections.filter((c) => !allColIds.has(c.id)),
            requests: s.requests.filter((r) => !doomed.includes(r.id)),
            environments: s.environments.filter((e) => !doomedEnvs.includes(e.id)),
            selectedRequestId: doomed.includes(s.selectedRequestId ?? '')
              ? null
              : s.selectedRequestId,
            openTabs: s.openTabs.filter((id) => !doomed.includes(id)),
            // deleted the open collection (or an ancestor)? back to the list
            openCollectionId: allColIds.has(s.openCollectionId ?? '')
              ? null
              : s.openCollectionId,
            expandedFolders: s.expandedFolders.filter((id) => !allColIds.has(id)),
            pendingDeletes: {
              ...s.pendingDeletes,
              collections: [...s.pendingDeletes.collections, ...allColIds],
              requests: [...s.pendingDeletes.requests, ...doomed],
              environments: [...s.pendingDeletes.environments, ...doomedEnvs],
            },
          }
        }),

      addRequest: (collectionId) => {
        const id = uid()
        set((s) => {
          const requests: ApiRequest[] = [
            ...s.requests,
            {
              id,
              projectId:
                (collectionId
                  ? s.collections.find((c) => c.id === collectionId)?.projectId
                  : undefined) ??
                s.openProjectId ??
                s.projects[0]!.id,
              collectionId,
              name: 'New request',
              method: 'GET' as const,
              url: '',
              headers: [],
              queryParams: [],
              body: null,
              bodyType: 'none' as const,
              sortOrder: nextSort(s.requests),
              version: 1,
              updatedAt: now(),
            },
          ]
          return {
            requests,
            selectedRequestId: id,
            openTabs: withTab(s.openTabs, s.collections, requests, id),
          }
        })
        return id
      },

      updateRequest: (id, patch) =>
        set((s) => ({
          requests: s.requests.map((r) =>
            r.id === id ? { ...r, ...patch, version: r.version + 1, updatedAt: now() } : r,
          ),
        })),

      deleteRequest: (id) =>
        set((s) => ({
          requests: s.requests.filter((r) => r.id !== id),
          selectedRequestId: s.selectedRequestId === id ? null : s.selectedRequestId,
          openTabs: s.openTabs.filter((t) => t !== id),
          pendingDeletes: {
            ...s.pendingDeletes,
            requests: [...s.pendingDeletes.requests, id],
          },
        })),

      // Selecting is what fills the strip, wherever it came from. `null` is the
      // "back to the start" case and opens nothing.
      selectRequest: (id) =>
        set((s) =>
          id === null
            ? { selectedRequestId: null }
            : {
                selectedRequestId: id,
                openTabs: withTab(s.openTabs, s.collections, s.requests, id),
              },
        ),

      openTab: (id) =>
        set((s) => ({
          selectedRequestId: id,
          openTabs: withTab(s.openTabs, s.collections, s.requests, id),
        })),

      closeTab: (id) =>
        set((s) => {
          if (!s.openTabs.includes(id)) return s
          const openTabs = s.openTabs.filter((t) => t !== id)
          if (s.selectedRequestId !== id) return { openTabs }
          // Closing the active tab falls to the right neighbour, then the left,
          // and only within the same collection — a jump would swap the env.
          const scope = tabScope(s.collections, s.requests, id)
          const siblings = s.openTabs.filter(
            (t) => tabScope(s.collections, s.requests, t) === scope,
          )
          const at = siblings.indexOf(id)
          return { openTabs, selectedRequestId: siblings[at + 1] ?? siblings[at - 1] ?? null }
        }),

      closeOtherTabs: (id) =>
        set((s) => {
          const scope = tabScope(s.collections, s.requests, id)
          return {
            openTabs: s.openTabs.filter(
              (t) => t === id || tabScope(s.collections, s.requests, t) !== scope,
            ),
            // The surviving tab is the active one: any other selection just
            // closed and would point at nothing.
            selectedRequestId: id,
          }
        }),

      closeAllTabs: () =>
        set((s) => {
          const scope = openScope(s)
          const stays = (t: string) => tabScope(s.collections, s.requests, t) !== scope
          return {
            openTabs: s.openTabs.filter(stays),
            selectedRequestId:
              s.selectedRequestId && stays(s.selectedRequestId) ? s.selectedRequestId : null,
          }
        }),

      duplicateRequest: (id) =>
        set((s) => {
          const original = s.requests.find((r) => r.id === id)
          if (!original) return s
          const copy: ApiRequest = {
            ...structuredClone(original),
            id: uid(),
            name: `${original.name} (copy)`,
            // half a step ahead: the copy lands right below the original
            sortOrder: original.sortOrder + 0.5,
            version: 1,
            updatedAt: now(),
          }
          const requests = [...s.requests, copy]
          return {
            requests,
            selectedRequestId: copy.id,
            openTabs: withTab(s.openTabs, s.collections, requests, copy.id),
          }
        }),

      moveRequest: (id, collectionId, index) =>
        set((s) => {
          const moved = s.requests.find((r) => r.id === id)
          if (!moved) return s

          const siblings = s.requests
            .filter((r) => r.collectionId === collectionId && r.id !== id)
            .sort(bySortOrder)
          const clamped = Math.max(0, Math.min(index, siblings.length))
          const ordered = [
            ...siblings.slice(0, clamped),
            moved,
            ...siblings.slice(clamped),
          ]

          const position = new Map(ordered.map((r, i) => [r.id, i]))

          // Touch only what actually moved — every write becomes a sync push.
          let changed = false
          const requests = s.requests.map((r) => {
            const i = position.get(r.id)
            if (i === undefined) return r
            const reparented = r.id === id && r.collectionId !== collectionId
            if (!reparented && r.sortOrder === i) return r
            changed = true
            return {
              ...r,
              collectionId: r.id === id ? collectionId : r.collectionId,
              sortOrder: i,
              version: r.version + 1,
              updatedAt: now(),
            }
          })
          return changed ? { requests } : s
        }),

      moveCollection: (id, index) =>
        set((s) => {
          const moved = s.collections.find((c) => c.id === id)
          if (!moved) return s

          // Only siblings take part: reindexing the global list would shuffle
          // other parents' folders, since the index is relative to siblings.
          const others = s.collections
            .filter((c) => c.id !== id && c.parentId === moved.parentId && c.projectId === moved.projectId)
            .sort(bySortOrder)
          const clamped = Math.max(0, Math.min(index, others.length))
          const ordered = [...others.slice(0, clamped), moved, ...others.slice(clamped)]
          const position = new Map(ordered.map((c, i) => [c.id, i]))

          return {
            collections: s.collections.map((c) => {
              const i = position.get(c.id)
              if (i === undefined || c.sortOrder === i) return c
              return { ...c, sortOrder: i, version: c.version + 1, updatedAt: now() }
            }),
          }
        }),

      // Import (Insomnia/cURL): extra base environments merge into the local base.
      importData: (data) =>
        set((s) => {
          // Push incoming items to the end, or they collide with the local sortOrder.
          const colOffset = nextSort(s.collections.filter((c) => c.parentId === null))
          const reqOffset = nextSort(s.requests)

          const collections = [
            ...s.collections,
            ...(data.collections ?? []).map((c) => ({
              ...c,
              sortOrder: c.parentId === null ? c.sortOrder + colOffset : c.sortOrder,
            })),
          ]
          const requests = [
            ...s.requests,
            ...(data.requests ?? []).map((r) => ({
              ...r,
              sortOrder: r.sortOrder + reqOffset,
            })),
          ]
          const first = data.requests?.[0]?.id ?? null

          return {
            collections,
            requests,
            // The importer already hangs envs on the new collection with unique
            // names; merging against other collections would corrupt the import.
            environments: [...s.environments, ...(data.environments ?? [])],
            selectedRequestId: first ?? s.selectedRequestId,
            openTabs: first ? withTab(s.openTabs, collections, requests, first) : s.openTabs,
          }
        }),

      addEnvironment: (collectionId) => {
        const id = uid()
        set((s) => {
          // unique name and order only matter inside the owning collection
          const siblings = s.environments.filter((e) => e.collectionId === collectionId)
          return {
            environments: [
              ...s.environments,
              {
                id,
                collectionId,
                name: uniqueEnvName(
                  'new-env',
                  siblings.map((e) => e.name),
                ),
                isBase: false,
                color: '#8b5cf6',
                variables: [],
                sortOrder: nextSort(siblings),
                version: 1,
                updatedAt: now(),
              },
            ],
          }
        })
        return id
      },

      updateEnvironment: (id, patch) =>
        set((s) => ({
          environments: s.environments.map((e) =>
            e.id === id ? { ...e, ...patch, version: e.version + 1, updatedAt: now() } : e,
          ),
        })),

      deleteEnvironment: (id) =>
        set((s) => ({
          environments: s.environments.filter((e) => e.id !== id || e.isBase),
          activeEnvByCollection: Object.fromEntries(
            Object.entries(s.activeEnvByCollection).map(([colId, envId]) => [
              colId,
              envId === id ? null : envId,
            ]),
          ),
          pendingDeletes: {
            ...s.pendingDeletes,
            environments: [...s.pendingDeletes.environments, id],
          },
        })),

      setActiveEnv: (collectionId, envId) =>
        set((s) => ({
          activeEnvByCollection: { ...s.activeEnvByCollection, [collectionId]: envId },
        })),

      moveEnvironment: (id, index) =>
        set((s) => {
          const moved = s.environments.find((e) => e.id === id)
          if (!moved) return s

          // order is relative to the envs of the same collection
          const others = s.environments
            .filter((e) => e.id !== id && e.collectionId === moved.collectionId)
            .sort(bySortOrder)
          const clamped = Math.max(0, Math.min(index, others.length))
          const ordered = [...others.slice(0, clamped), moved, ...others.slice(clamped)]
          const position = new Map(ordered.map((e, i) => [e.id, i]))

          return {
            environments: s.environments.map((e) => {
              const i = position.get(e.id)
              if (i === undefined || e.sortOrder === i) return e
              return { ...e, sortOrder: i, version: e.version + 1, updatedAt: now() }
            }),
          }
        }),

      pushHistory: (entry) =>
        set((s) => {
          const list = s.history[entry.requestId] ?? []
          const item: HistoryEntry = {
            ...entry,
            id: uid(),
            at: now(),
            body: entry.body.slice(0, MAX_HISTORY_BODY),
          }
          return {
            history: {
              ...s.history,
              [entry.requestId]: [item, ...list].slice(0, MAX_HISTORY_PER_REQUEST),
            },
          }
        }),

      clearHistory: (requestId) =>
        set((s) => {
          const { [requestId]: _, ...rest } = s.history
          return { history: rest }
        }),
    }),
    {
      name: 'somnolent-workspace',
      version: 2,
      migrate: (persisted, version) => migrateWorkspace(persisted, version) as never,
    },
  ),
)

/** The collection driving the variable context: the open request's root or, with
 *  no request, the open collection. No collection means no variables. */
export function useContextCollectionId(): string | null {
  return useStore((s) => {
    const selected = s.requests.find((r) => r.id === s.selectedRequestId)
    const from = selected?.collectionId ?? s.openCollectionId
    return rootCollectionOf(s.collections, from)?.id ?? null
  })
}

export function useActiveEnv() {
  const collectionId = useContextCollectionId()
  return useStore((s) => {
    if (!collectionId) return null
    const activeId = s.activeEnvByCollection[collectionId]
    if (!activeId) return null
    return (
      s.environments.find((e) => e.id === activeId && e.collectionId === collectionId) ?? null
    )
  })
}

export function useBaseEnv() {
  const collectionId = useContextCollectionId()
  return useStore((s) =>
    collectionId
      ? (s.environments.find((e) => e.isBase && e.collectionId === collectionId) ?? null)
      : null,
  )
}

const NO_ENVS: Environment[] = []

/** Filtering happens in a useMemo, not in the selector: a selector returning a
 *  fresh array every call makes zustand see a change and React loop. */
export function useCollectionEnvs(collectionId: string | null): Environment[] {
  const environments = useStore((s) => s.environments)
  return useMemo(
    () =>
      collectionId ? environments.filter((e) => e.collectionId === collectionId) : NO_ENVS,
    [environments, collectionId],
  )
}

export function useSelectedRequest() {
  return useStore((s) => s.requests.find((r) => r.id === s.selectedRequestId) ?? null)
}

/** State keeps every tab the person opened; the strip shows only the current
 *  collection's slice, so switching collection hides tabs instead of closing them. */
export function useVisibleTabs(): ApiRequest[] {
  const openTabs = useStore((s) => s.openTabs)
  const requests = useStore((s) => s.requests)
  const collections = useStore((s) => s.collections)
  const selectedRequestId = useStore((s) => s.selectedRequestId)
  const openCollectionId = useStore((s) => s.openCollectionId)
  return useMemo(() => {
    const scope = openScope({ collections, requests, selectedRequestId, openCollectionId })
    const byId = new Map(requests.map((r) => [r.id, r]))
    return openTabs.flatMap((id) => {
      const request = byId.get(id)
      if (!request) return []
      const root = rootCollectionOf(collections, request.collectionId)?.id ?? null
      return root === scope ? [request] : []
    })
  }, [openTabs, requests, collections, selectedRequestId, openCollectionId])
}
