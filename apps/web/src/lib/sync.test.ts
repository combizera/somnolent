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

describe('syncNow pushes only the connected project', () => {
  it('pushes no collections, requests or environments of other projects', async () => {
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
    // environment hanging off the other project's collection
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
    // and what belongs to the connected project does go up
    expect(payload.changes.collections.length).toBeGreaterThan(0)
  })
})

describe('a run of failures', () => {
  /** Leaves the store with a valid connection, or syncNow returns doing nothing. */
  function conectado() {
    const s = useStore.getState()
    useStore.setState({
      connection: {
        ...s.connection,
        key: 'somn_x',
        role: 'write',
        scope: 'project',
        projectId: s.openProjectId!,
      },
    })
  }

  it('logs only the first error of a run, not one per attempt', async () => {
    conectado()
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => {})

    // a success first resets the failure counter, which is module state
    sync.mockResolvedValueOnce({ now: '2026-09-02T00:00:00.000Z', changes: {}, deletes: {} })
    await syncNow()

    sync.mockRejectedValue(new Error('Failed to fetch'))
    await syncNow()
    await syncNow()
    await syncNow()

    // With the API down, polling keeps trying on its own; one log per attempt
    // buried every other console message.
    expect(console_).toHaveBeenCalledTimes(1)

    // and it logs again after a recovery followed by another break
    sync.mockResolvedValueOnce({ now: '2026-09-02T00:00:00.000Z', changes: {}, deletes: {} })
    await syncNow()
    await syncNow()
    expect(console_).toHaveBeenCalledTimes(2)

    console_.mockRestore()
    sync.mockReset()
  })
})
