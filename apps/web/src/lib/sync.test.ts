import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Collection } from '@somnolent/core'

const sync = vi.fn(async () => ({ now: '2026-09-02T00:00:00.000Z', changes: {}, deletes: {} }))
vi.mock('./api', () => ({
  api: { sync: (...args: unknown[]) => sync(...(args as [])) },
  wsUrl: () => 'ws://localhost:4000/sync/ws',
}))

const { useStore } = await import('../store')
const { syncNow } = await import('./sync')

const initialState = useStore.getState()
beforeEach(() => {
  useStore.setState(initialState, true)
  sync.mockClear()
})

const col = (id: string, projectId: string): Collection => ({
  id, projectId, parentId: null, name: id, sortOrder: 0, version: 1,
  updatedAt: '2026-09-01T00:00:00.000Z',
})

describe('syncNow sobe só o project conectado', () => {
  it('não empurra collections, requests nem environments dos outros projects', async () => {
    const s = useStore.getState()
    const conectado = s.openProjectId!
    useStore.setState({
      collections: [...s.collections, col('c-outro', 'outro-project')],
      connection: {
        ...s.connection,
        key: 'somn_x',
        role: 'write',
        scope: 'project',
        projectId: conectado,
      },
    })
    // environment que pende da collection do outro project
    const outroEnv = { id: 'e-outro', collectionId: 'c-outro', name: 'prod', isBase: false,
      variables: [], sortOrder: 0, version: 1, updatedAt: '2026-09-01T00:00:00.000Z' }
    useStore.setState({ environments: [...useStore.getState().environments, outroEnv] })

    await syncNow()

    expect(sync).toHaveBeenCalledOnce()
    const [, payload] = sync.mock.calls[0] as unknown as [string, {
      changes: { collections: Collection[]; requests: { projectId: string }[]; environments: { id: string }[] }
    }]
    expect(payload.changes.collections.every((c) => c.projectId === conectado)).toBe(true)
    expect(payload.changes.requests.every((r) => r.projectId === conectado)).toBe(true)
    expect(payload.changes.collections.map((c) => c.id)).not.toContain('c-outro')
    expect(payload.changes.environments.map((e) => e.id)).not.toContain('e-outro')
    // e o que é do project conectado sobe
    expect(payload.changes.collections.length).toBeGreaterThan(0)
  })
})
