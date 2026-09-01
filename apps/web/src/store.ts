import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { migrateWorkspace } from './lib/migrate'
import { rootCollectionOf, uniqueEnvName } from '@somnolent/core'
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

/**
 * A ordem da sidebar vive em `sortOrder`, não na ordem do array: o sync manda
 * cada entidade por conta própria, então a posição precisa viajar com ela.
 */
export const bySortOrder = <T extends { sortOrder: number }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder

const nextSort = (items: { sortOrder: number }[]) =>
  items.reduce((max, it) => Math.max(max, it.sortOrder), -1) + 1

function seed() {
  const project: Project = {
    id: uid(),
    name: 'Pessoal',
    sortOrder: 0,
    version: 1,
    updatedAt: now(),
  }
  // Os environments pertencem a uma collection, então o seed precisa de uma.
  const collection: Collection = {
    id: uid(),
    projectId: project.id,
    parentId: null,
    name: 'Exemplos',
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
  /** Project aberto no seletor do header — escolha local, não sincroniza. */
  openProjectId: string | null
  collections: Collection[]
  requests: ApiRequest[]
  environments: Environment[]
  /**
   * Environment ativo por collection: dá pra estar em prod numa collection e
   * em local na outra. Escolha local, não sincroniza.
   */
  activeEnvByCollection: Record<string, string | null>
  selectedRequestId: string | null
  /**
   * Collection aberta na sidebar (navegação em 2 níveis, como o Insomnia).
   * É escolha local de quem navega: não sincroniza.
   */
  openCollectionId: string | null
  history: Record<string, HistoryEntry[]>

  /**
   * Conexão de sync. Não há conta: a chave é a credencial e o que ela abre
   * (project inteiro ou uma collection) vem do servidor em /me.
   */
  connection: {
    key: string | null
    scope: 'project' | 'collection' | null
    role: 'write' | 'read' | null
    label: string | null
    projectName: string | null
    collectionId: string | null
  }
  lastSyncAt: string | null
  pendingDeletes: PendingDeletes

  connect: (key: string, info: Omit<AppState['connection'], 'key'>) => void
  disconnect: () => void
  setLastSyncAt: (at: string) => void
  clearPendingDeletes: (pushed: PendingDeletes) => void
  replaceAllData: () => void
  applyRemote: (changes: RemoteChanges, deletes: Partial<PendingDeletes>) => void

  addProject: (name: string) => string
  renameProject: (id: string, name: string) => void
  deleteProject: (id: string) => void
  openProject: (id: string) => void

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

  addEnvironment: (collectionId: string) => string
  /** Reordena os environments na lista do gerenciador (o base também entra). */
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
      ...seed(),

      connection: {
        key: null,
        scope: null,
        role: null,
        label: null,
        projectName: null,
        collectionId: null,
      },
      lastSyncAt: null,
      pendingDeletes: { collections: [], requests: [], environments: [] },

      connect: (key, info) => set({ connection: { key, ...info }, lastSyncAt: null }),

      disconnect: () =>
        set({
          connection: {
            key: null,
            scope: null,
            role: null,
            label: null,
            projectName: null,
            collectionId: null,
          },
          lastSyncAt: null,
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

      // Ao entrar num workspace de outra pessoa: zera o conteúdo local
      // (o primeiro sync puxa tudo do servidor).
      replaceAllData: () =>
        set({
          collections: [],
          requests: [],
          environments: [],
          activeEnvByCollection: {},
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
            // env que sumiu no remoto não pode ficar ativo em collection nenhuma
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

      /** Apagar um project leva as collections dele (e o que pende delas). */
      deleteProject: (id) =>
        set((s) => {
          if (s.projects.length <= 1) return s // sempre sobra um project
          const colIds = new Set(s.collections.filter((c) => c.projectId === id).map((c) => c.id))
          const reqIds = s.requests
            .filter((r) => r.projectId === id || (r.collectionId && colIds.has(r.collectionId)))
            .map((r) => r.id)
          const envIds = s.environments
            .filter((e) => colIds.has(e.collectionId))
            .map((e) => e.id)
          const projects = s.projects.filter((p) => p.id !== id)
          return {
            projects,
            collections: s.collections.filter((c) => !colIds.has(c.id)),
            requests: s.requests.filter((r) => !reqIds.includes(r.id)),
            environments: s.environments.filter((e) => !envIds.includes(e.id)),
            openProjectId: s.openProjectId === id ? (projects[0]?.id ?? null) : s.openProjectId,
            openCollectionId: colIds.has(s.openCollectionId ?? '') ? null : s.openCollectionId,
            selectedRequestId: reqIds.includes(s.selectedRequestId ?? '')
              ? null
              : s.selectedRequestId,
            pendingDeletes: {
              collections: [...s.pendingDeletes.collections, ...colIds],
              requests: [...s.pendingDeletes.requests, ...reqIds],
              environments: [...s.pendingDeletes.environments, ...envIds],
            },
          }
        }),

      openProject: (id) => set({ openProjectId: id, openCollectionId: null }),

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
          // environment pertence à collection: apagar a collection apaga os envs dela
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
            // apagou a collection aberta (ou uma ancestral dela)? volta pra lista
            openCollectionId: allColIds.has(s.openCollectionId ?? '')
              ? null
              : s.openCollectionId,
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
        set((s) => ({
          requests: [
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
            // Env importado com nome já usado entra como "staging 2", não como
            // duplicata; e a ordem dele começa depois da dos locais.
            environments: rest.reduce(
              (acc, env) => [
                ...acc,
                {
                  ...env,
                  name: uniqueEnvName(env.name, acc.map((e) => e.name)),
                  sortOrder: nextSort(acc),
                },
              ],
              environments,
            ),
            selectedRequestId: data.requests?.[0]?.id ?? s.selectedRequestId,
          }
        }),

      addEnvironment: (collectionId) => {
        const id = uid()
        set((s) => {
          // nome único e ordem contam só dentro da collection dona
          const siblings = s.environments.filter((e) => e.collectionId === collectionId)
          return {
            environments: [
              ...s.environments,
              {
                id,
                collectionId,
                name: uniqueEnvName(
                  'novo-env',
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

          // a ordem é relativa aos envs da mesma collection
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

/**
 * Collection que manda no contexto de variáveis agora: a raiz da request
 * aberta ou, sem request, a collection aberta na sidebar. Environment pertence
 * à collection, então sem collection não há variável.
 */
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

/**
 * Environments da collection em contexto.
 *
 * O filtro fica FORA do seletor de propósito: seletor que devolve array novo a
 * cada chamada faz o zustand achar que o estado mudou e o React entra em loop
 * ("getSnapshot should be cached"). Aqui o seletor devolve a referência crua e
 * o recorte acontece num useMemo.
 */
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
