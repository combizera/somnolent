import { beforeEach, describe, expect, it } from 'vitest'
import {
  REQUEST_TABS,
  SIDEBAR,
  SPLIT_DEFAULT,
  sanitizeLayout,
  sanitizeTabs,
  useLayout,
} from './layoutStore'

const initial = useLayout.getState()
beforeEach(() => useLayout.setState(initial, true))

describe('layoutStore', () => {
  it('clamps the sidebar between the minimum and the maximum', () => {
    useLayout.getState().setSidebarWidth(9999)
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.max)

    useLayout.getState().setSidebarWidth(-40)
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.min)
  })

  it('keeps NaN out — it would leak into the grid and localStorage', () => {
    // NaN comes from dividing by zero before the container has a width, and
    // Math.max(NaN, lo) is NaN, so the clamp has to stop it first.
    useLayout.getState().setSidebarWidth(Number.NaN)
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.min)

    useLayout.getState().setRequestSplit(Number.NaN)
    expect(Number.isFinite(useLayout.getState().requestSplit)).toBe(true)

    useLayout.getState().setRequestSplit(Number.POSITIVE_INFINITY)
    expect(Number.isFinite(useLayout.getState().requestSplit)).toBe(true)
  })

  it('resets to the defaults', () => {
    useLayout.getState().setSidebarWidth(400)
    useLayout.getState().setRequestSplit(0.8)
    useLayout.getState().resetSidebar()
    useLayout.getState().resetSplit()

    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.default)
    expect(useLayout.getState().requestSplit).toBe(SPLIT_DEFAULT)
  })
})

describe('what comes back from the browser', () => {
  it('null becomes the default — JSON.stringify(NaN) is null, and it would reach the grid', () => {
    expect(sanitizeLayout({ sidebarWidth: null, requestSplit: null })).toEqual({
      sidebarWidth: SIDEBAR.default,
      requestSplit: SPLIT_DEFAULT,
      requestTabs: REQUEST_TABS,
    })
  })

  it('an out-of-range value is clamped, not discarded', () => {
    expect(sanitizeLayout({ sidebarWidth: 9999, requestSplit: 3 })).toEqual({
      sidebarWidth: SIDEBAR.max,
      requestSplit: 0.95,
      requestTabs: REQUEST_TABS,
    })
  })

  it('garbage of any shape falls back to the default', () => {
    const padrao = {
      sidebarWidth: SIDEBAR.default,
      requestSplit: SPLIT_DEFAULT,
      requestTabs: REQUEST_TABS,
    }
    expect(sanitizeLayout(undefined)).toEqual(padrao)
    expect(sanitizeLayout({})).toEqual(padrao)
    expect(sanitizeLayout({ sidebarWidth: '300', requestSplit: {} })).toEqual(padrao)
    expect(sanitizeLayout({ sidebarWidth: Number.NaN })).toEqual(padrao)
  })

  it('a good value passes through untouched', () => {
    expect(sanitizeLayout({ sidebarWidth: 300, requestSplit: 0.4 })).toEqual({
      sidebarWidth: 300,
      requestSplit: 0.4,
      requestTabs: REQUEST_TABS,
    })
  })
})

describe('request tab order', () => {
  it('dragging right drops after the neighbour; left, before it', () => {
    useLayout.getState().moveRequestTab('params', 'body')
    expect(useLayout.getState().requestTabs).toEqual(['headers', 'auth', 'body', 'params'])

    useLayout.getState().moveRequestTab('body', 'headers')
    expect(useLayout.getState().requestTabs).toEqual(['body', 'headers', 'auth', 'params'])
  })

  it('dropping a tab on itself changes nothing', () => {
    useLayout.getState().moveRequestTab('auth', 'auth')
    expect(useLayout.getState().requestTabs).toEqual(REQUEST_TABS)
  })

  it('resets to the factory order', () => {
    useLayout.getState().moveRequestTab('body', 'params')
    useLayout.getState().resetRequestTabs()
    expect(useLayout.getState().requestTabs).toEqual(REQUEST_TABS)
  })

  it('stored order is a preference, not the list: a new tab joins, an unknown name drops', () => {
    // An order saved before Auth existed must not hide it.
    expect(sanitizeTabs(['body', 'params', 'scripts'])).toEqual([
      'body',
      'params',
      'headers',
      'auth',
    ])
    expect(sanitizeTabs(['auth', 'auth'])).toEqual(['auth', 'params', 'headers', 'body'])
    expect(sanitizeTabs('lixo')).toEqual(REQUEST_TABS)
  })
})
