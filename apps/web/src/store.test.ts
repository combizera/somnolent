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

describe('importData with per-collection environments', () => {
  it('never merges the imported base into another collection base', () => {
    const s = useStore.getState()
    const local = s.collections.find((c) => c.parentId === null)!
    const baseLocalAntes = s.environments.find((e) => e.isBase && e.collectionId === local.id)!

    s.importData({
      collections: [col('imp', s.openProjectId!, null)],
      requests: [req('r-imp', s.openProjectId!, 'imp')],
      environments: [env('e-base', 'imp', 'Base', true), env('e-prod', 'imp', 'prod')],
    })

    const depois = useStore.getState()
    // the imported base exists, in the imported collection
    expect(depois.environments.find((e) => e.id === 'e-base')?.collectionId).toBe('imp')
    // the local base was left untouched
    const baseLocal = depois.environments.find((e) => e.id === baseLocalAntes.id)!
    expect(baseLocal.variables).toEqual(baseLocalAntes.variables)
    expect(baseLocal.version).toBe(baseLocalAntes.version)
  })

  it('does not rename an env over a clash in ANOTHER collection', () => {
    const s = useStore.getState()
    // the seed already has "staging" in the Examples collection
    s.importData({
      collections: [col('imp', s.openProjectId!, null)],
      environments: [env('e-stg', 'imp', 'staging')],
    })
    expect(useStore.getState().environments.find((e) => e.id === 'e-stg')?.name).toBe('staging')
  })

  it('an imported folder gets no top-level sortOrder offset', () => {
    const s = useStore.getState()
    s.importData({
      collections: [col('raiz', s.openProjectId!, null, 0), col('filha', s.openProjectId!, 'raiz', 0)],
    })
    const filha = useStore.getState().collections.find((c) => c.id === 'filha')!
    expect(filha.sortOrder).toBe(0)
  })
})

describe('moveCollection reindexes siblings only', () => {
  it('reordering inside a folder leaves another parent alone', () => {
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

    // move A2 ahead of A1
    useStore.getState().moveCollection('A2', 0)

    const depois = Object.fromEntries(
      useStore.getState().collections.map((c) => [c.id, c.sortOrder]),
    )
    expect(depois['A2']).toBe(0)
    expect(depois['A1']).toBe(1)
    // B and B's children stay exactly as they were
    expect(depois['B']).toBe(1)
    expect(depois['B1']).toBe(0)
    expect(depois['B2']).toBe(1)
    // and the roots were not dragged into it either
    expect(depois['A']).toBe(0)
  })
})

describe('withScope: the push carries the rootCollectionId', () => {
  const tree = [col('root', 'p', null), col('sub', 'p', 'root')]

  it('a request in a subfolder points at the root collection', () => {
    const scoped = withScope(tree).request(req('r', 'p', 'sub'))
    expect(scoped.rootCollectionId).toBe('root')
  })

  it('a request straight in the root does too', () => {
    expect(withScope(tree).request(req('r', 'p', 'root')).rootCollectionId).toBe('root')
  })

  it('a loose request goes unscoped, visible only to a project key', () => {
    expect(withScope(tree).request(req('r', 'p', null)).rootCollectionId).toBeNull()
  })

  it('a subfolder points at the root; the root points at itself', () => {
    expect(withScope(tree).collection(tree[1]!).rootCollectionId).toBe('root')
    expect(withScope(tree).collection(tree[0]!).rootCollectionId).toBe('root')
  })
})

describe('local project bound to the server project', () => {
  const remote = { id: 'srv-1', name: 'Catcher' }

  it('adoptRemoteProject re-tags the open project and everything inside it', () => {
    const antes = useStore.getState()
    const local = antes.openProjectId!
    const colLocal = antes.collections.find((c) => c.projectId === local)!

    antes.adoptRemoteProject(remote)

    const s = useStore.getState()
    expect(s.openProjectId).toBe(remote.id)
    expect(s.connection.projectId).toBe(remote.id)
    expect(s.projects.map((p) => p.id)).toContain(remote.id)
    expect(s.projects.map((p) => p.id)).not.toContain(local)
    // without this the sidebar filters by projectId and finds nothing
    expect(s.collections.find((c) => c.id === colLocal.id)!.projectId).toBe(remote.id)
    expect(s.requests.every((r) => r.projectId === remote.id)).toBe(true)
    // fresh updatedAt, or the incremental push would not carry the re-tagging
    expect(s.collections[0]!.updatedAt > colLocal.updatedAt).toBe(true)
  })

  it('enterRemoteProject clears only the connected project', () => {
    const inicial = useStore.getState()
    const outro = inicial.openProjectId!
    // old content of the remote project, from an earlier connection
    useStore.setState({
      collections: [...inicial.collections, col('c-srv', remote.id, null)],
      requests: [...inicial.requests, req('r-srv', remote.id, 'c-srv')],
      environments: [...inicial.environments, env('e-srv', 'c-srv', 'prod')],
    })

    useStore.getState().enterRemoteProject(remote)

    const s = useStore.getState()
    expect(s.openProjectId).toBe(remote.id)
    // the connected project starts empty: the first pull brings everything
    expect(s.collections.filter((c) => c.projectId === remote.id)).toEqual([])
    expect(s.requests.filter((r) => r.projectId === remote.id)).toEqual([])
    expect(s.environments.find((e) => e.id === 'e-srv')).toBeUndefined()
    // and this machine's local project stays intact
    expect(s.collections.some((c) => c.projectId === outro)).toBe(true)
    expect(s.requests.some((r) => r.projectId === outro)).toBe(true)
    expect(s.environments.some((e) => e.collectionId !== 'c-srv')).toBe(true)
  })

  it('applyRemote re-tags what arrives with the connected projectId', () => {
    useStore.setState({
      connection: { ...useStore.getState().connection, key: 'somn_x', projectId: remote.id },
    })

    // a row written by an older client, which pushed its own local projectId
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

describe('keyring: the machine remembers each project key', () => {
  const conn = (projectId: string, key: string) => ({
    scope: 'project' as const,
    role: 'write' as const,
    label: 'this machine',
    projectId,
    projectName: projectId,
    collectionId: null,
    key,
  })

  it('connect stores the key and switching project reconnects on its own', () => {
    const s = useStore.getState()
    const a = s.openProjectId!
    const b = s.addProject('Segundo')

    const { key: keyA, ...infoA } = conn(a, 'somn_a')
    useStore.getState().connect(keyA, infoA)
    expect(useStore.getState().keyring[a]?.key).toBe('somn_a')

    // switch to the local project: no key, so no sync
    useStore.getState().openProject(b)
    expect(useStore.getState().connection.key).toBeNull()

    // publish the second and go back: the first key comes back with it
    const { key: keyB, ...infoB } = conn(b, 'somn_b')
    useStore.getState().connect(keyB, infoB)
    useStore.getState().openProject(a)
    expect(useStore.getState().connection.key).toBe('somn_a')
    expect(useStore.getState().connection.projectId).toBe(a)
    // lastSyncAt is per connection: switching must force a full pull
    expect(useStore.getState().lastSyncAt).toBeNull()

    useStore.getState().openProject(b)
    expect(useStore.getState().connection.key).toBe('somn_b')
  })

  it('adoptRemoteProject stores the legacy connection key', () => {
    // Connection saved before projectId existed: syncNow is what binds it,
    // calling adoptRemoteProject without going through connect().
    const local = useStore.getState().openProjectId!
    useStore.setState({
      connection: { ...useStore.getState().connection, key: 'somn_legado', role: 'write' },
    })

    useStore.getState().adoptRemoteProject({ id: 'srv-legado', name: 'Legado' })

    const outro = useStore.getState().addProject('Outro')
    useStore.getState().openProject(outro)
    useStore.getState().openProject('srv-legado')
    // without the keyring write, coming back would discard a live key
    expect(useStore.getState().connection.key).toBe('somn_legado')
    expect(local).not.toBe('srv-legado')
  })

  it('disconnecting forgets only the connected project key', () => {
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
    // without this, disconnecting and coming back would reconnect on its own
    expect(depois.keyring[a]?.key).toBe('somn_a')
  })

  it('deleting the project forgets its key', () => {
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

describe('tabs of the open requests', () => {
  /** Two projects stay out of here: the strip slices by collection. */
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

  /** Creates n requests in a collection and returns the ids, opening no tab. */
  const seedRequests = (projectId: string, collectionId: string, ids: string[]) => {
    useStore.setState((s) => ({
      requests: [...s.requests, ...ids.map((id) => req(id, projectId, collectionId))],
    }))
    return ids
  }

  it('selecting a request opens its tab, at the right', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2'])

    useStore.getState().selectRequest('r1')
    useStore.getState().selectRequest('r2')

    expect(useStore.getState().openTabs).toEqual(['r1', 'r2'])
  })

  it('reopening an already open tab does not move it', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2', 'r3'])
    ;['r1', 'r2', 'r3'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().openTab('r1')

    expect(useStore.getState().openTabs).toEqual(['r1', 'r2', 'r3'])
    expect(useStore.getState().selectedRequestId).toBe('r1')
  })

  it('going back home opens no tab at all', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1'])
    useStore.getState().selectRequest('r1')

    useStore.getState().selectRequest(null)

    expect(useStore.getState().openTabs).toEqual(['r1'])
    expect(useStore.getState().selectedRequestId).toBeNull()
  })

  it('on the 11th tab the oldest leaves and the last 10 stay', () => {
    const projectId = setup()
    const ids = Array.from({ length: 11 }, (_, i) => `r${i}`)
    seedRequests(projectId, 'A', ids)

    ids.forEach((id) => useStore.getState().selectRequest(id))

    expect(useStore.getState().openTabs).toEqual(ids.slice(1))
    expect(useStore.getState().openTabs).toHaveLength(MAX_TABS_PER_COLLECTION)
  })

  it('the cap is per collection: filling A closes no tab of B', () => {
    const projectId = setup()
    const inA = Array.from({ length: MAX_TABS_PER_COLLECTION }, (_, i) => `a${i}`)
    seedRequests(projectId, 'A', inA)
    seedRequests(projectId, 'B', ['b1'])

    useStore.getState().selectRequest('b1')
    inA.forEach((id) => useStore.getState().selectRequest(id))

    expect(useStore.getState().openTabs).toEqual(['b1', ...inA])
  })

  it('a request in a subfolder counts toward the root collection cap', () => {
    const projectId = setup()
    const raiz = Array.from({ length: MAX_TABS_PER_COLLECTION }, (_, i) => `a${i}`)
    seedRequests(projectId, 'A', raiz)
    seedRequests(projectId, 'sub', ['dentro'])

    raiz.forEach((id) => useStore.getState().selectRequest(id))
    useStore.getState().selectRequest('dentro')

    // 'sub' hangs off 'A', so the 11th evicts the oldest of 'A'
    expect(useStore.getState().openTabs).toEqual([...raiz.slice(1), 'dentro'])
  })

  it('closing the active tab falls to the right neighbour', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2', 'r3'])
    ;['r1', 'r2', 'r3'].forEach((id) => useStore.getState().selectRequest(id))
    useStore.getState().openTab('r2')

    useStore.getState().closeTab('r2')

    expect(useStore.getState().openTabs).toEqual(['r1', 'r3'])
    expect(useStore.getState().selectedRequestId).toBe('r3')
  })

  it('closing the last active tab falls to the left one', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2'])
    ;['r1', 'r2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().closeTab('r2')

    expect(useStore.getState().selectedRequestId).toBe('r1')
  })

  it('closing a tab that is not active leaves the selection alone', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2'])
    ;['r1', 'r2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().closeTab('r1')

    expect(useStore.getState().selectedRequestId).toBe('r2')
  })

  it('the neighbour is never from another collection', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['a1'])
    seedRequests(projectId, 'B', ['b1'])
    useStore.getState().selectRequest('b1')
    useStore.getState().selectRequest('a1')

    useStore.getState().closeTab('a1')

    // with no neighbour in A the selection empties instead of jumping to B
    expect(useStore.getState().selectedRequestId).toBeNull()
    expect(useStore.getState().openTabs).toEqual(['b1'])
  })

  it('closing the others leaves only the clicked one, active', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2', 'r3'])
    ;['r1', 'r2', 'r3'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().closeOtherTabs('r1')

    expect(useStore.getState().openTabs).toEqual(['r1'])
    expect(useStore.getState().selectedRequestId).toBe('r1')
  })

  it('closing the others spares the tabs of other collections', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['a1', 'a2'])
    seedRequests(projectId, 'B', ['b1'])
    ;['b1', 'a1', 'a2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().closeOtherTabs('a1')

    expect(useStore.getState().openTabs).toEqual(['b1', 'a1'])
  })

  it('closing all clears the collection in context and the selection', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['a1', 'a2'])
    seedRequests(projectId, 'B', ['b1'])
    ;['b1', 'a1', 'a2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().closeAllTabs()

    expect(useStore.getState().openTabs).toEqual(['b1'])
    expect(useStore.getState().selectedRequestId).toBeNull()
  })

  it('deleting the request closes its tab', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2'])
    ;['r1', 'r2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().deleteRequest('r1')

    expect(useStore.getState().openTabs).toEqual(['r2'])
  })

  it('deleting the collection closes the tabs of its requests', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['a1'])
    seedRequests(projectId, 'sub', ['dentro'])
    seedRequests(projectId, 'B', ['b1'])
    ;['a1', 'dentro', 'b1'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().deleteCollection('A')

    // 'sub' hangs off 'A' and goes with it
    expect(useStore.getState().openTabs).toEqual(['b1'])
  })

  it('a request deleted on the remote leaves no tab behind', () => {
    const projectId = setup()
    seedRequests(projectId, 'A', ['r1', 'r2'])
    ;['r1', 'r2'].forEach((id) => useStore.getState().selectRequest(id))

    useStore.getState().applyRemote(
      { collections: [], requests: [], environments: [] },
      { requests: ['r1'] },
    )

    expect(useStore.getState().openTabs).toEqual(['r2'])
  })

  it('a new request is born with a tab', () => {
    setup()
    const id = useStore.getState().addRequest('A')

    expect(useStore.getState().openTabs).toEqual([id])
    expect(useStore.getState().selectedRequestId).toBe(id)
  })

  it('duplicating opens the copy tab without closing the original', () => {
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
