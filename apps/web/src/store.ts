import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { uniqueEnvName } from '@somnolent/core'
import type { ApiRequest, Collection, Environment, HttpMethod } from '@somnolent/core'

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

const WS = 'ws-local'
const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

const MAX_HISTORY_PER_REQUEST = 20
const MAX_HISTORY_BODY = 100_000

/**
 * A ordem da sidebar vive em `sortOrder`, não na ordem do array: o sync manda
 * cada entidade por conta própria, então a posição precisa viajar com ela.
 */
export const bySortOrder = <T extends { sortOrder: number }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder

const nextSort = (items: { sortOrder: number }[]) =>
  items.reduce((max, it) => Math.max(max, it.sortOrder), -1) + 1

function seed() {
  const base: Environment = {
    id: uid(),
    workspaceId: WS,
    name: 'Base',
    isBase: true,
    variables: [{ key: 'page_size', value: '20', secret: false, enabled: true }],
    version: 1,
    updatedAt: now(),
  }
  const staging: Environment = {
    id: uid(),
    workspaceId: WS,
    name: 'staging',
    isBase: false,
    color: '#f59e0b',
    variables: [
      { key: 'base_url', value: 'https://httpbin.org', secret: false, enabled: true },
      { key: 'token', value: 'stg-token-123', secret: true, enabled: true },
    ],
    version: 1,
    updatedAt: now(),
  }
  const prod: Environment = {
    id: uid(),
    workspaceId: WS,
    name: 'prod',
    isBase: false,
    color: '#ef4444',
    variables: [
      { key: 'base_url', value: 'https://httpbin.org', secret: false, enabled: true },
      { key: 'token', value: 'prd-token-789', secret: true, enabled: true },
    ],
    version: 1,
    updatedAt: now(),
  }
  const request: ApiRequest = {
    id: uid(),
    workspaceId: WS,
    collectionId: null,
    name: 'Exemplo — GET com vars',
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
  return { environments: [base, staging, prod], requests: [request], activeEnvId: staging.id, selectedRequestId: request.id }
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
  collections: Collection[]
  requests: ApiRequest[]
  environments: Environment[]
  activeEnvId: string | null
  selectedRequestId: string | null
  /**
   * Collection aberta na sidebar (navegação em 2 níveis, como o Insomnia).
   * É escolha local de quem navega: não sincroniza.
   */
  openCollectionId: string | null
  history: Record<string, HistoryEntry[]>

  auth: { token: string | null; email: string | null }
  server: { workspaceId: string | null; name: string | null }
  lastSyncAt: string | null
  pendingDeletes: PendingDeletes

  setAuth: (token: string, email: string) => void
  clearAuth: () => void
  setServerWorkspace: (workspaceId: string, name: string) => void
  disconnectWorkspace: () => void
  setLastSyncAt: (at: string) => void
  clearPendingDeletes: (pushed: PendingDeletes) => void
  replaceAllData: () => void
  applyRemote: (changes: RemoteChanges, deletes: Partial<PendingDeletes>) => void

  addCollection: (name: string) => string
  /** Entra numa collection (ou volta pra lista, com null). */
  openCollection: (id: string | null) => void
  addSubCollection: (parentId: string, name: string) => void
  renameCollection: (id: string, name: string) => void
  deleteCollection: (id: string) => void

  addRequest: (collectionId: string | null) => string
  updateRequest: (id: string, patch: Partial<ApiRequest>) => void
  deleteRequest: (id: string) => void
  duplicateRequest: (id: string) => void
  selectRequest: (id: string | null) => void
  /** Move uma request para uma pasta (ou raiz) na posição indicada. */
  moveRequest: (id: string, collectionId: string | null, index: number) => void
  /** Reordena uma pasta entre as outras. */
  moveCollection: (id: string, index: number) => void
  importData: (data: {
    collections?: Collection[]
    requests?: ApiRequest[]
    environments?: Environment[]
  }) => void

  addEnvironment: () => string
  updateEnvironment: (id: string, patch: Partial<Environment>) => void
  deleteEnvironment: (id: string) => void
  setActiveEnv: (id: string | null) => void

  pushHistory: (entry: Omit<HistoryEntry, 'id' | 'at'>) => void
  clearHistory: (requestId: string) => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      collections: [],
      history: {},
      openCollectionId: null,
      ...seed(),

      auth: { token: null, email: null },
      server: { workspaceId: null, name: null },
      lastSyncAt: null,
      pendingDeletes: { collections: [], requests: [], environments: [] },

      setAuth: (token, email) => set({ auth: { token, email } }),
      clearAuth: () =>
        set({
          auth: { token: null, email: null },
          server: { workspaceId: null, name: null },
          lastSyncAt: null,
        }),
      setServerWorkspace: (workspaceId, name) =>
        set({ server: { workspaceId, name }, lastSyncAt: null }),
      disconnectWorkspace: () =>
        set({ server: { workspaceId: null, name: null }, lastSyncAt: null }),
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

      // Ao entrar num workspace de outra pessoa: zera o conteúdo local
      // (o primeiro sync puxa tudo do servidor).
      replaceAllData: () =>
        set({
          collections: [],
          requests: [],
          environments: [],
          activeEnvId: null,
          selectedRequestId: null,
          openCollectionId: null,
          history: {},
          pendingDeletes: { collections: [], requests: [], environments: [] },
        }),

      applyRemote: (changes, deletes) =>
        set((s) => {
          // Preserva a referência do array quando nada muda — senão o engine
          // de sync interpreta o próprio applyRemote como edição e loopa.
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

          // Variáveis secretas chegam do servidor com valor vazio:
          // preserva o valor local desta máquina, casando por chave.
          const mergeEnv = (local: Environment | undefined, remote: Environment): Environment => ({
            ...remote,
            variables: remote.variables.map((v) => {
              if (!v.secret || v.value !== '') return v
              const mine = local?.variables.find((lv) => lv.key === v.key)
              return mine ? { ...v, value: mine.value } : v
            }),
          })

          const requests = merge(s.requests, changes.requests, deletes.requests)
          const environments = merge(s.environments, changes.environments, deletes.environments, mergeEnv)

          return {
            collections: merge(s.collections, changes.collections, deletes.collections),
            requests,
            environments,
            selectedRequestId: requests.some((r) => r.id === s.selectedRequestId)
              ? s.selectedRequestId
              : null,
            activeEnvId: environments.some((e) => e.id === s.activeEnvId) ? s.activeEnvId : null,
          }
        }),

      addCollection: (name) => {
        const id = uid()
        set((s) => ({
          collections: [
            ...s.collections,
            {
              id,
              workspaceId: WS,
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
              workspaceId: WS,
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
          return {
            collections: s.collections.filter((c) => !allColIds.has(c.id)),
            requests: s.requests.filter((r) => !doomed.includes(r.id)),
            selectedRequestId: doomed.includes(s.selectedRequestId ?? '')
              ? null
              : s.selectedRequestId,
            // apagou a collection aberta (ou uma ancestral dela)? volta pra lista
            openCollectionId: allColIds.has(s.openCollectionId ?? '')
              ? null
              : s.openCollectionId,
            pendingDeletes: {
              ...s.pendingDeletes,
              collections: [...s.pendingDeletes.collections, ...allColIds],
              requests: [...s.pendingDeletes.requests, ...doomed],
            },
          }
        }),

      addRequest: (collectionId) => {
        const id = uid()
        set((s) => ({
          requests: [
            ...s.requests,
            {
              id,
              workspaceId: WS,
              collectionId,
              name: 'Nova request',
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
          ],
          selectedRequestId: id,
        }))
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
          pendingDeletes: {
            ...s.pendingDeletes,
            requests: [...s.pendingDeletes.requests, id],
          },
        })),

      selectRequest: (id) => set({ selectedRequestId: id }),

      duplicateRequest: (id) =>
        set((s) => {
          const original = s.requests.find((r) => r.id === id)
          if (!original) return s
          const copy: ApiRequest = {
            ...structuredClone(original),
            id: uid(),
            name: `${original.name} (cópia)`,
            // meio passo à frente: a cópia aparece logo abaixo do original
            sortOrder: original.sortOrder + 0.5,
            version: 1,
            updatedAt: now(),
          }
          return { requests: [...s.requests, copy], selectedRequestId: copy.id }
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

          // Só toca em quem realmente mudou — cada escrita vira um push no sync.
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

          const others = s.collections.filter((c) => c.id !== id).sort(bySortOrder)
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

      // Import (Insomnia/cURL): environments base extras são mesclados no base local.
      importData: (data) =>
        set((s) => {
          const incomingBase = (data.environments ?? []).filter((e) => e.isBase)
          const rest = (data.environments ?? []).filter((e) => !e.isBase)
          let environments = s.environments
          const localBase = environments.find((e) => e.isBase)
          if (incomingBase.length > 0 && localBase) {
            const extraVars = incomingBase
              .flatMap((e) => e.variables)
              .filter((v) => !localBase.variables.some((lv) => lv.key === v.key))
            environments = environments.map((e) =>
              e.isBase
                ? { ...e, variables: [...e.variables, ...extraVars], version: e.version + 1, updatedAt: now() }
                : e,
            )
          } else if (incomingBase.length > 0) {
            environments = [...environments, ...incomingBase]
          }
          // Empurra o que chega pro fim da lista, senão colide com o sortOrder local.
          const colOffset = nextSort(s.collections)
          const reqOffset = nextSort(s.requests)

          return {
            collections: [
              ...s.collections,
              ...(data.collections ?? []).map((c) => ({
                ...c,
                sortOrder: c.sortOrder + colOffset,
              })),
            ],
            requests: [
              ...s.requests,
              ...(data.requests ?? []).map((r) => ({
                ...r,
                sortOrder: r.sortOrder + reqOffset,
              })),
            ],
            // Env importado com nome já usado entra como "staging 2", não como duplicata.
            environments: rest.reduce(
              (acc, env) => [
                ...acc,
                { ...env, name: uniqueEnvName(env.name, acc.map((e) => e.name)) },
              ],
              environments,
            ),
            selectedRequestId: data.requests?.[0]?.id ?? s.selectedRequestId,
          }
        }),

      addEnvironment: () => {
        const id = uid()
        set((s) => ({
          environments: [
            ...s.environments,
            {
              id,
              workspaceId: WS,
              name: uniqueEnvName(
                'novo-env',
                s.environments.map((e) => e.name),
              ),
              isBase: false,
              color: '#8b5cf6',
              variables: [],
              version: 1,
              updatedAt: now(),
            },
          ],
        }))
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
          activeEnvId: s.activeEnvId === id ? null : s.activeEnvId,
          pendingDeletes: {
            ...s.pendingDeletes,
            environments: [...s.pendingDeletes.environments, id],
          },
        })),

      setActiveEnv: (id) => set({ activeEnvId: id }),

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
    { name: 'somnolent-workspace' },
  ),
)

export function useActiveEnv() {
  return useStore((s) => s.environments.find((e) => e.id === s.activeEnvId) ?? null)
}

export function useBaseEnv() {
  return useStore((s) => s.environments.find((e) => e.isBase) ?? null)
}

export function useSelectedRequest() {
  return useStore((s) => s.requests.find((r) => r.id === s.selectedRequestId) ?? null)
}
