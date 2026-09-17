import { describe, expect, it } from 'vitest'

/** A separate file because the store rehydrates on module import: localStorage
 *  has to be dirty before that. */
localStorage.setItem(
  'somnolent-layout',
  // `null` is what a stored NaN leaves behind: JSON.stringify(NaN) === 'null'
  JSON.stringify({ state: { sidebarWidth: null, requestSplit: null }, version: 0 }),
)

const { useLayout, SIDEBAR, SPLIT_DEFAULT } = await import('./layoutStore')

describe('rehydration with a corrupted value in the browser', () => {
  it('keeps the stored null out of the state', () => {
    const { sidebarWidth, requestSplit } = useLayout.getState()
    expect(sidebarWidth).toBe(SIDEBAR.default)
    expect(requestSplit).toBe(SPLIT_DEFAULT)
    // without this the grid would get `minmax(0,nullfr)` and break on each reload
    expect(Number.isFinite(sidebarWidth)).toBe(true)
    expect(Number.isFinite(requestSplit)).toBe(true)
  })
})
