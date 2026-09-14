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

/**
 * Teto de abas POR collection, não global: a barra mostra uma collection por
 * vez, então o teto de uma não pode comer as abas da outra.
 */
export const MAX_TABS_PER_COLLECTION = 10

/** O que basta pra saber quais abas aparecem e sob qual collection. */
interface TabContext {
  collections: Collection[]
  requests: ApiRequest[]
  selectedRequestId: string | null
  openCollectionId: string | null
}

/**
 * Collection raiz de uma request — é por ela que a barra recorta as abas.
 * `null` cobre dois casos de uma vez: request que não existe mais e request
 * fora de collection. Nenhum dos dois aparece com uma collection aberta.
 */
function tabScope(
  collections: Collection[],
  requests: ApiRequest[],
  requestId: string,
): string | null {
  const request = requests.find((r) => r.id === requestId)
  if (!request) return null
  return rootCollectionOf(collections, request.collectionId)?.id ?? null
}

/**
 * Collection que a barra está mostrando. Mesma regra do contexto de variáveis
 * (`useContextCollectionId`) de propósito: a barra e o environment ativo têm
 * que concordar sobre onde a pessoa está, senão clicar numa aba trocaria o
 * environment sem trocar a barra.
 */
function openScope(s: TabContext): string | null {
  const selected = s.requests.find((r) => r.id === s.selectedRequestId)
  return rootCollectionOf(s.collections, selected?.collectionId ?? s.openCollectionId)?.id ?? null
}

/**
 * Abre a aba de uma request à direita das que já estão. Passou do teto, sai a
 * mais antiga DA MESMA collection: a ordem na barra não se mexe sozinha, e
 * reabrir é um clique na sidebar.
 */
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

export interface Connection {
  key: string | null
  scope: 'project' | 'collection' | null
  role: 'write' | 'read' | null
  label: string | null
  /** Id do project NO SERVIDOR — e também do project local, depois de amarrado. */
  projectId: string | null
  projectName: string | null
  collectionId: string | null
}

/**
 * Grava a conexão no keyring. Toda action que mexe em `connection` passa por
 * aqui: sem isso o keyring fica dessincronizado e trocar de project descarta
 * uma chave viva.
 */
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
  /**
   * Pastas que a pessoa deixou abertas. Guardamos as ABERTAS, não as fechadas:
   * assim pasta nova — recém-criada ou recém-importada — nasce fechada, e
   * recarregar a página devolve exatamente o que estava aberto.
   * Array, não Set: o persist serializa em JSON e Set viraria `{}`.
   */
  expandedFolders: string[]
  /**
   * Requests abertas na barra de abas, em ordem de posição — a mais recente
   * entra à direita. Escolha local de navegação: não sincroniza, como o
   * `openCollectionId` e o `expandedFolders`.
   * Array, não Set, pelo mesmo motivo: o persist serializa em JSON.
   */
  openTabs: string[]
  history: Record<string, HistoryEntry[]>

  /**
   * Conexão de sync. Não há conta: a chave é a credencial e o que ela abre
   * (project inteiro ou uma collection) vem do servidor em /me.
   */
  connection: Connection
  /**
   * Chave de cada project que esta máquina já abriu. É o que faz compartilhar
   * ser uma ação repetível em vez de um momento único: ninguém precisa ter
   * anotado a chave, e trocar de project no header reconecta sozinho.
   */
  keyring: Record<string, Connection>
  lastSyncAt: string | null
  pendingDeletes: PendingDeletes

  connect: (key: string, info: Omit<Connection, 'key'>) => void
  disconnect: () => void
  setLastSyncAt: (at: string) => void
  clearPendingDeletes: (pushed: PendingDeletes) => void
  /**
   * Amarra o project local ao project do servidor: o id local passa a ser o do
   * servidor. Sem isto as entidades sobem com um `projectId` que só existe
   * nesta máquina, e quem entra depois puxa tudo pra um project que não tem —
   * a sidebar filtra por `projectId` e a tela fica vazia.
   * Usado ao criar um project (o project aberto vira o compartilhado) e ao
   * reconectar uma conexão salva antes de o `projectId` existir.
   */
  adoptRemoteProject: (project: { id: string; name: string }) => void
  /**
   * Entra no project de outra pessoa: cria o project local com o id do
   * servidor e limpa só o que houver dentro dele — o primeiro pull traz tudo.
   * Os outros projects locais ficam intactos: agora só o project conectado
   * sincroniza.
   */
  enterRemoteProject: (project: { id: string; name: string }) => void
  applyRemote: (changes: RemoteChanges, deletes: Partial<PendingDeletes>) => void

  addProject: (name: string) => string
  renameProject: (id: string, name: string) => void
  deleteProject: (id: string) => void
  openProject: (id: string) => void

  addCollection: (name: string) => string
  /** Entra numa collection (ou volta pra lista, com null). */
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
  /** Abre (ou traz pra frente) a aba de uma request e a seleciona. */
  openTab: (id: string) => void
  closeTab: (id: string) => void
  /** Fecha as outras abas DA MESMA collection e deixa esta ativa. */
  closeOtherTabs: (id: string) => void
  /** Fecha todas as abas da collection em contexto. */
  closeAllTabs: () => void
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

      // "Desconectar esta máquina" tem que esquecer a chave também — senão
      // trocar de project e voltar reconectaria sozinho.
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
          // Este caminho também roda pela reconexão legada, que não passa por
          // `connect` — sem gravar aqui, a chave viva se perderia na troca.
          const keyring = remember(s.keyring, connection)
          if (!from || from === id) {
            // Já amarrado, ou não havia project aberto: só garante que ele
            // existe na lista com o nome do servidor.
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
          // `updatedAt` novo em tudo que foi re-etiquetado: o push manda só o
          // que mudou depois do último sync, e aqui o `projectId` mudou.
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
            // Limpa só o project conectado — os outros projects locais desta
            // máquina não sincronizam e não têm por que ser apagados.
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

          // Tudo que chega pertence ao project conectado. Re-etiquetar defende
          // contra linhas gravadas por um cliente antigo, que subia o
          // `projectId` local dele: sem isto a sidebar filtra e não mostra nada.
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
          const keyring = { ...s.keyring }
          delete keyring[id]
          const nextOpen = s.openProjectId === id ? (projects[0]?.id ?? null) : s.openProjectId
          // Apagou o project conectado: a conexão passa a ser a do project que
          // ficou aberto, ou nenhuma.
          const nextConnection = (nextOpen && keyring[nextOpen]) || NO_CONNECTION
          return {
            projects,
            keyring,
            connection: nextConnection,
            // `lastSyncAt` é por conexão: trocou de conexão, o próximo sync
            // tem que ser completo.
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

      // Trocar de project troca a conexão: o MVP sincroniza um project por
      // máquina, e a chave de cada um está no keyring.
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
            // `lastSyncAt` é por conexão: mantê-lo faria o pull do project novo
            // pedir só o que mudou depois de um sync que foi de outro project.
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
            openTabs: s.openTabs.filter((id) => !doomed.includes(id)),
            // apagou a collection aberta (ou uma ancestral dela)? volta pra lista
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

      // Selecionar é o que povoa a barra: veio da sidebar, do Ctrl+K ou de uma
      // aba, a request passa a ter aba. `null` é o "voltar pro início" e não
      // abre nada.
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
          // Fechou a aba ativa: cai na vizinha da direita e, na última, na da
          // esquerda. Só entre abas da mesma collection — pular pra outra
          // trocaria o environment por baixo de quem só fechou uma aba.
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
            // A aba que sobrou é a ativa: se a anterior era outra, ela acabou
            // de fechar e deixar a seleção apontando pro nada.
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
            name: `${original.name} (cópia)`,
            // meio passo à frente: a cópia aparece logo abaixo do original
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

          // Só as irmãs entram na dança: reindexar a lista global embaralharia
          // a ordem das pastas dos outros pais (o índice vem relativo às irmãs).
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

      // Import (Insomnia/cURL): environments base extras são mesclados no base local.
      importData: (data) =>
        set((s) => {
          // Empurra o que chega pro fim da lista, senão colide com o sortOrder local.
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
            // Environments chegam do importer já pendurados na collection nova,
            // com nomes únicos dentro dela. Mesclar no base local ou renomear
            // contra os envs das OUTRAS collections era coisa do modelo antigo
            // (env por workspace) — hoje só corromperia o import.
            environments: [...s.environments, ...(data.environments ?? [])],
            selectedRequestId: first ?? s.selectedRequestId,
            openTabs: first ? withTab(s.openTabs, collections, requests, first) : s.openTabs,
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

/**
 * Abas visíveis: as da collection em contexto, na ordem em que entraram.
 *
 * O recorte mora aqui, e não dentro do `openTabs`, porque são duas perguntas
 * diferentes: o estado guarda tudo que a pessoa abriu, e a barra mostra só o
 * pedaço da collection de agora. Trocar de collection não fecha nada — as
 * abas da outra voltam quando você volta. E id de request que sumiu (apagada
 * no colega, project trocado) nunca chega a virar aba na tela, mesmo se algum
 * caminho de poda deixar passar.
 *
 * O filtro fica num `useMemo` pelo mesmo motivo do `useCollectionEnvs`:
 * seletor que devolve array novo a cada chamada faz o zustand achar que o
 * estado mudou e o React entra em loop.
 */
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
