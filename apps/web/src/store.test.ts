import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_TABS_PER_COLLECTION, useStore } from './store'
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

describe('abas das requests abertas', () => {
  /** Dois projects não entram aqui: a barra recorta por collection. */
  const setup = () => {
    const projectId = useStore.getState().openProjectId!
    useStore.setState({
      collections: [col('A', projectId, null), col('sub', projectId, 'A'), col('B', projectId, null)],
      requests: [],
      openCollectionId: 'A',
      selectedRequestId: null,
      openTabs: [],
    })
    return projectId
  }

  /** Cria n requests numa collection e devolve os ids, sem abrir aba. */
  const seedRequests = (projectId: string, collectionId: string, ids: string[]) => {
    useStore.setState((s) => ({
      requests: [...s.requests, ...ids.map((id) => req(id, projectId, collectionId))],
    }))
    return ids
  }

  it('selecionar uma request abre a aba dela, à direita', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2'])

    useStore.getState().selectRequest('r1')
    useStore.getState().selectRequest('r2')

    expect(useStore.getState().openTabs).toEqual(['r1', 'r2'])
  })

  it('reabrir uma aba já aberta não a move de posição', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2', 'r3'])
    ;['r1', 'r2', 'r3'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().openTab('r1')

    expect(useStore.getState().openTabs).toEqual(['r1', 'r2', 'r3'])
    expect(useStore.getState().selectedRequestId).toBe('r1')
  })

  it('voltar pro início não abre aba nenhuma', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1'])
    useStore.getState().selectRequest('r1')

    useStore.getState().selectRequest(null)

    expect(useStore.getState().openTabs).toEqual(['r1'])
    expect(useStore.getState().selectedRequestId).toBeNull()
  })

  it('na 11ª aba a mais antiga sai e as 10 últimas ficam', () => {
    const projectId = setup()
    const ids = Array.from({ length: 11 }, (_, i) => `r${i}`)
    seedRequests(projectId, 'A', ids)

    ids.forEach((id) => useStore.getState().selectRequest(id))

    expect(useStore.getState().openTabs).toEqual(ids.slice(1))
    expect(useStore.getState().openTabs).toHaveLength(MAX_TABS_PER_COLLECTION)
  })

  it('o teto é por collection: encher A não fecha aba de B', () => {
    const projectId = setup()
    const inA = Array.from({ length: MAX_TABS_PER_COLLECTION }, (_, i) => `a${i}`)
    seedRequests(projectId, 'A', inA)
    seedRequests(projectId, 'B', ['b1'])

    useStore.getState().selectRequest('b1')
    inA.forEach((id) => useStore.getState().selectRequest(id))

    expect(useStore.getState().openTabs).toEqual(['b1', ...inA])
  })

  it('request em subpasta conta no teto da collection raiz', () => {
    const projectId = setup()
    const raiz = Array.from({ length: MAX_TABS_PER_COLLECTION }, (_, i) => `a${i}`)
    seedRequests(projectId, 'A', raiz)
    seedRequests(projectId, 'sub', ['dentro'])

    raiz.forEach((id) => useStore.getState().selectRequest(id))
    useStore.getState().selectRequest('dentro')

    // 'sub' pende de 'A', então a 11ª derruba a mais antiga de 'A'
    expect(useStore.getState().openTabs).toEqual([...raiz.slice(1), 'dentro'])
  })

  it('fechar a aba ativa cai na vizinha da direita', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2', 'r3'])
    ;['r1', 'r2', 'r3'].forEach((id) => useStore.getState().selectRequest(id))
    useStore.getState().openTab('r2')

    useStore.getState().closeTab('r2')

    expect(useStore.getState().openTabs).toEqual(['r1', 'r3'])
    expect(useStore.getState().selectedRequestId).toBe('r3')
  })

  it('fechar a última aba ativa cai na da esquerda', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2'])
    ;['r1', 'r2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().closeTab('r2')

    expect(useStore.getState().selectedRequestId).toBe('r1')
  })

  it('fechar aba que não é a ativa não mexe na seleção', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2'])
    ;['r1', 'r2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().closeTab('r1')

    expect(useStore.getState().selectedRequestId).toBe('r2')
  })

  it('a vizinha nunca é de outra collection', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['a1'])
    seedRequests(projectId, 'B', ['b1'])
    useStore.getState().selectRequest('b1')
    useStore.getState().selectRequest('a1')

    useStore.getState().closeTab('a1')

    // sem vizinha em A, a seleção esvazia — não pula pra B e troca o environment
    expect(useStore.getState().selectedRequestId).toBeNull()
    expect(useStore.getState().openTabs).toEqual(['b1'])
  })

  it('fechar as outras deixa só a clicada, e ativa', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2', 'r3'])
    ;['r1', 'r2', 'r3'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().closeOtherTabs('r1')

    expect(useStore.getState().openTabs).toEqual(['r1'])
    expect(useStore.getState().selectedRequestId).toBe('r1')
  })

  it('fechar as outras poupa as abas das outras collections', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['a1', 'a2'])
    seedRequests(projectId, 'B', ['b1'])
    ;['b1', 'a1', 'a2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().closeOtherTabs('a1')

    expect(useStore.getState().openTabs).toEqual(['b1', 'a1'])
  })

  it('fechar todas limpa a collection em contexto e a seleção', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['a1', 'a2'])
    seedRequests(projectId, 'B', ['b1'])
    ;['b1', 'a1', 'a2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().closeAllTabs()

    expect(useStore.getState().openTabs).toEqual(['b1'])
    expect(useStore.getState().selectedRequestId).toBeNull()
  })

  it('apagar a request fecha a aba dela', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2'])
    ;['r1', 'r2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().deleteRequest('r1')

    expect(useStore.getState().openTabs).toEqual(['r2'])
  })

  it('apagar a collection fecha as abas das requests dela', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['a1'])
    seedRequests(projectId, 'sub', ['dentro'])
    seedRequests(projectId, 'B', ['b1'])
    ;['a1', 'dentro', 'b1'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().deleteCollection('A')

    // 'sub' pende de 'A' e cai junto
    expect(useStore.getState().openTabs).toEqual(['b1'])
  })

  it('request apagada no remoto não sobra como aba', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2'])
    ;['r1', 'r2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().applyRemote(
      { collections: [], requests: [], environments: [] },
      { requests: ['r1'] },
    )

    expect(useStore.getState().openTabs).toEqual(['r2'])
  })

  it('request nova nasce com aba', () => {
    setup()
    const id = useStore.getState().addRequest('A')

    expect(useStore.getState().openTabs).toEqual([id])
    expect(useStore.getState().selectedRequestId).toBe(id)
  })

  it('duplicar abre a aba da cópia sem fechar a do original', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1'])
    useStore.getState().selectRequest('r1')

    useStore.getState().duplicateRequest('r1')

    const depois = useStore.getState()
    expect(depois.openTabs).toHaveLength(2)
    expect(depois.openTabs[0]).toBe('r1')
    expect(depois.selectedRequestId).toBe(depois.openTabs[1])
  })
})
