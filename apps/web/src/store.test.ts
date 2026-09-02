import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store'
import { withScope } from './lib/sync'
import type { ApiRequest, Collection, Environment } from '@somnolent/core'

const initialState = useStore.getState()
beforeEach(() => useStore.setState(initialState, true))

const col = (id: string, projectId: string, parentId: string | null, sortOrder = 0): Collection => ({
  id, projectId, parentId, name: id, sortOrder, version: 1, updatedAt: '2026-09-01T00:00:00.000Z',
})
const env = (id: string, collectionId: string, name: string, isBase = false): Environment => ({
  id, collectionId, name, isBase, variables: [{ key: 'base_url', value: 'x', secret: false, enabled: true }],
  sortOrder: 0, version: 1, updatedAt: '2026-09-01T00:00:00.000Z',
})
const req = (id: string, projectId: string, collectionId: string | null): ApiRequest => ({
  id, projectId, collectionId, name: id, method: 'GET', url: '/x', headers: [], queryParams: [],
  body: null, bodyType: 'none', sortOrder: 0, version: 1, updatedAt: '2026-09-01T00:00:00.000Z',
})

describe('importData com environments por collection', () => {
  it('não mescla o base importado no base de outra collection', () => {
    const s = useStore.getState()
    const local = s.collections.find((c) => c.parentId === null)!
    const baseLocalAntes = s.environments.find((e) => e.isBase && e.collectionId === local.id)!

    s.importData({
      collections: [col('imp', s.openProjectId!, null)],
      requests: [req('r-imp', s.openProjectId!, 'imp')],
      environments: [env('e-base', 'imp', 'Base', true), env('e-prod', 'imp', 'prod')],
    })

    const depois = useStore.getState()
    // o base importado existe, na collection importada
    expect(depois.environments.find((e) => e.id === 'e-base')?.collectionId).toBe('imp')
    // o base local não foi tocado
    const baseLocal = depois.environments.find((e) => e.id === baseLocalAntes.id)!
    expect(baseLocal.variables).toEqual(baseLocalAntes.variables)
    expect(baseLocal.version).toBe(baseLocalAntes.version)
  })

  it('não renomeia env por colidir com nome de OUTRA collection', () => {
    const s = useStore.getState()
    // o seed já tem "staging" na collection Exemplos
    s.importData({
      collections: [col('imp', s.openProjectId!, null)],
      environments: [env('e-stg', 'imp', 'staging')],
    })
    expect(useStore.getState().environments.find((e) => e.id === 'e-stg')?.name).toBe('staging')
  })

  it('pasta importada não ganha offset de sortOrder de topo', () => {
    const s = useStore.getState()
    s.importData({
      collections: [col('raiz', s.openProjectId!, null, 0), col('filha', s.openProjectId!, 'raiz', 0)],
    })
    const filha = useStore.getState().collections.find((c) => c.id === 'filha')!
    expect(filha.sortOrder).toBe(0)
  })
})

describe('moveCollection reindexa só as irmãs', () => {
  it('reordenar dentro de uma pasta não mexe na ordem de outro pai', () => {
    const s = useStore.getState()
    const prj = s.openProjectId!
    useStore.setState({
      collections: [
        col('A', prj, null, 0),
        col('A1', prj, 'A', 0),
        col('A2', prj, 'A', 1),
        col('B', prj, null, 1),
        col('B1', prj, 'B', 0),
        col('B2', prj, 'B', 1),
      ],
    })

    // move A2 pra frente de A1
    useStore.getState().moveCollection('A2', 0)

    const depois = Object.fromEntries(
      useStore.getState().collections.map((c) => [c.id, c.sortOrder]),
    )
    expect(depois['A2']).toBe(0)
    expect(depois['A1']).toBe(1)
    // B e as filhas de B ficam exatamente como estavam
    expect(depois['B']).toBe(1)
    expect(depois['B1']).toBe(0)
    expect(depois['B2']).toBe(1)
    // e as raízes também não foram arrastadas pra dança
    expect(depois['A']).toBe(0)
  })
})

describe('withScope: o push carrega o rootCollectionId', () => {
  const tree = [col('root', 'p', null), col('sub', 'p', 'root')]

  it('request em subpasta aponta pra collection raiz', () => {
    const scoped = withScope(tree).request(req('r', 'p', 'sub'))
    expect(scoped.rootCollectionId).toBe('root')
  })

  it('request direto na raiz também', () => {
    expect(withScope(tree).request(req('r', 'p', 'root')).rootCollectionId).toBe('root')
  })

  it('request solta no project vai sem escopo (só chave de project enxerga)', () => {
    expect(withScope(tree).request(req('r', 'p', null)).rootCollectionId).toBeNull()
  })

  it('subpasta aponta pra raiz; a raiz aponta pra si mesma', () => {
    expect(withScope(tree).collection(tree[1]!).rootCollectionId).toBe('root')
    expect(withScope(tree).collection(tree[0]!).rootCollectionId).toBe('root')
  })
})

describe('project local amarrado ao project do servidor', () => {
  const remote = { id: 'srv-1', name: 'Catcher' }

  it('adoptRemoteProject re-etiqueta o project aberto e o que está dentro dele', () => {
    const antes = useStore.getState()
    const local = antes.openProjectId!
    const colLocal = antes.collections.find((c) => c.projectId === local)!

    antes.adoptRemoteProject(remote)

    const s = useStore.getState()
    expect(s.openProjectId).toBe(remote.id)
    expect(s.connection.projectId).toBe(remote.id)
    expect(s.projects.map((p) => p.id)).toContain(remote.id)
    expect(s.projects.map((p) => p.id)).not.toContain(local)
    // sem isto a sidebar filtra por projectId e não acha mais nada
    expect(s.collections.find((c) => c.id === colLocal.id)!.projectId).toBe(remote.id)
    expect(s.requests.every((r) => r.projectId === remote.id)).toBe(true)
    // updatedAt novo, senão o push incremental não levaria a re-etiquetagem
    expect(s.collections[0]!.updatedAt > colLocal.updatedAt).toBe(true)
  })

  it('enterRemoteProject limpa só o project conectado e preserva os outros', () => {
    const inicial = useStore.getState()
    const outro = inicial.openProjectId!
    // conteúdo antigo do project remoto, de uma conexão anterior
    useStore.setState({
      collections: [...inicial.collections, col('c-srv', remote.id, null)],
      requests: [...inicial.requests, req('r-srv', remote.id, 'c-srv')],
      environments: [...inicial.environments, env('e-srv', 'c-srv', 'prod')],
    })

    useStore.getState().enterRemoteProject(remote)

    const s = useStore.getState()
    expect(s.openProjectId).toBe(remote.id)
    // o project conectado começa vazio: o primeiro pull traz tudo
    expect(s.collections.filter((c) => c.projectId === remote.id)).toEqual([])
    expect(s.requests.filter((r) => r.projectId === remote.id)).toEqual([])
    expect(s.environments.find((e) => e.id === 'e-srv')).toBeUndefined()
    // e o project local desta máquina fica intacto
    expect(s.collections.some((c) => c.projectId === outro)).toBe(true)
    expect(s.requests.some((r) => r.projectId === outro)).toBe(true)
    expect(s.environments.some((e) => e.collectionId !== 'c-srv')).toBe(true)
  })

  it('applyRemote re-etiqueta o que chega com o projectId conectado', () => {
    useStore.setState({
      connection: { ...useStore.getState().connection, key: 'somn_x', projectId: remote.id },
    })

    // linha gravada por um cliente antigo, que subia o projectId local dele
    useStore.getState().applyRemote(
      {
        collections: [col('c-legado', 'projeto-de-outra-maquina', null)],
        requests: [req('r-legado', 'projeto-de-outra-maquina', 'c-legado')],
      },
      {},
    )

    const s = useStore.getState()
    expect(s.collections.find((c) => c.id === 'c-legado')!.projectId).toBe(remote.id)
    expect(s.requests.find((r) => r.id === 'r-legado')!.projectId).toBe(remote.id)
  })
})

describe('keyring: a máquina lembra a chave de cada project', () => {
  const conn = (projectId: string, key: string) => ({
    scope: 'project' as const,
    role: 'write' as const,
    label: 'esta máquina',
    projectId,
    projectName: projectId,
    collectionId: null,
    key,
  })

  it('connect guarda a chave e trocar de project reconecta sozinho', () => {
    const s = useStore.getState()
    const a = s.openProjectId!
    const b = s.addProject('Segundo')

    const { key: keyA, ...infoA } = conn(a, 'somn_a')
    useStore.getState().connect(keyA, infoA)
    expect(useStore.getState().keyring[a]?.key).toBe('somn_a')

    // troca pro project local: nada de chave, então nada de sync
    useStore.getState().openProject(b)
    expect(useStore.getState().connection.key).toBeNull()

    // publica o segundo e volta pro primeiro: a chave do primeiro volta com ele
    const { key: keyB, ...infoB } = conn(b, 'somn_b')
    useStore.getState().connect(keyB, infoB)
    useStore.getState().openProject(a)
    expect(useStore.getState().connection.key).toBe('somn_a')
    expect(useStore.getState().connection.projectId).toBe(a)
    // lastSyncAt é por conexão: trocar tem que forçar um pull completo
    expect(useStore.getState().lastSyncAt).toBeNull()

    useStore.getState().openProject(b)
    expect(useStore.getState().connection.key).toBe('somn_b')
  })

  it('adoptRemoteProject guarda a chave da conexão legada', () => {
    // Conexão salva antes de o projectId existir: quem amarra é o syncNow,
    // que chama adoptRemoteProject sem passar por connect().
    const local = useStore.getState().openProjectId!
    useStore.setState({
      connection: { ...useStore.getState().connection, key: 'somn_legado', role: 'write' },
    })

    useStore.getState().adoptRemoteProject({ id: 'srv-legado', name: 'Legado' })

    const outro = useStore.getState().addProject('Outro')
    useStore.getState().openProject(outro)
    useStore.getState().openProject('srv-legado')
    // sem gravar no keyring, voltar pro project descartaria uma chave viva
    expect(useStore.getState().connection.key).toBe('somn_legado')
    expect(local).not.toBe('srv-legado')
  })

  it('desconectar esquece só a chave do project conectado', () => {
    const s = useStore.getState()
    const a = s.openProjectId!
    const b = s.addProject('Segundo')
    const { key: keyA, ...infoA } = conn(a, 'somn_a')
    const { key: keyB, ...infoB } = conn(b, 'somn_b')
    useStore.getState().connect(keyA, infoA)
    useStore.getState().connect(keyB, infoB)

    useStore.getState().disconnect()

    const depois = useStore.getState()
    expect(depois.connection.key).toBeNull()
    expect(depois.keyring[b]).toBeUndefined()
    // sem isto, "desconectar" e voltar pro project reconectaria sozinho
    expect(depois.keyring[a]?.key).toBe('somn_a')
  })

  it('apagar o project esquece a chave dele', () => {
    const s = useStore.getState()
    const a = s.openProjectId!
    const b = s.addProject('Segundo')
    const { key, ...info } = conn(b, 'somn_b')
    useStore.getState().openProject(b)
    useStore.getState().connect(key, info)

    useStore.getState().deleteProject(b)

    const depois = useStore.getState()
    expect(depois.keyring[b]).toBeUndefined()
    expect(depois.openProjectId).toBe(a)
    expect(depois.connection.key).toBeNull()
  })
})
