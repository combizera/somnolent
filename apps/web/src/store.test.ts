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
