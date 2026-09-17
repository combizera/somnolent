import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Panel widths live apart from the workspace on purpose: they are a local
 *  choice, not content, so they never enter the blob sync reads. */

/** Sidebar in px: the collection list need not follow the window. */
export const SIDEBAR = { min: 200, default: 272, max: 520 } as const

/** Floor in px for request and response — below it the panel is unusable. */
export const PANE_MIN = 320

/** Fraction of the remaining area given to the request; the rest is the response's. */
export const SPLIT_DEFAULT = 0.5

/** Request panel tabs, in factory order. */
export type RequestTab = 'params' | 'headers' | 'auth' | 'body'
export const REQUEST_TABS: RequestTab[] = ['params', 'headers', 'auth', 'body']

interface LayoutState {
  sidebarWidth: number
  requestSplit: number
  /** Drag order chosen by the user; applies to every request. */
  requestTabs: RequestTab[]
  setSidebarWidth: (px: number) => void
  setRequestSplit: (fraction: number) => void
  /** Moves tab `from` to `to`'s slot, like a drop between neighbours. */
  moveRequestTab: (from: RequestTab, to: RequestTab) => void
  resetSidebar: () => void
  resetSplit: () => void
  resetRequestTabs: () => void
}

/** NaN falls to the floor: Math.max(NaN, lo) is NaN and would leak to grid and storage. */
const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo

/** What comes back from the browser is untrusted — `JSON.stringify(NaN)` is
 *  `null` — and `persist` injects it without passing through the setters' clamp. */
export function sanitizeLayout(persisted: unknown): Pick<
  LayoutState,
  'sidebarWidth' | 'requestSplit' | 'requestTabs'
> {
  const saved = (persisted ?? {}) as Partial<
    Record<'sidebarWidth' | 'requestSplit' | 'requestTabs', unknown>
  >
  const num = (v: unknown, lo: number, hi: number, padrao: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : padrao
  return {
    sidebarWidth: num(saved.sidebarWidth, SIDEBAR.min, SIDEBAR.max, SIDEBAR.default),
    requestSplit: num(saved.requestSplit, 0.05, 0.95, SPLIT_DEFAULT),
    requestTabs: sanitizeTabs(saved.requestTabs),
  }
}

/**
 * Stored order is a preference, not the tab list: unknown names drop out and a
 * new tab joins at the end, so today's order cannot hide tomorrow's tab.
 */
export function sanitizeTabs(persisted: unknown): RequestTab[] {
  const saved = Array.isArray(persisted) ? persisted : []
  const known = saved.filter((t): t is RequestTab => REQUEST_TABS.includes(t as RequestTab))
  const ordered = [...new Set(known)]
  return [...ordered, ...REQUEST_TABS.filter((t) => !ordered.includes(t))]
}

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarWidth: SIDEBAR.default,
      requestSplit: SPLIT_DEFAULT,
      requestTabs: REQUEST_TABS,
      setSidebarWidth: (px) => set({ sidebarWidth: clamp(px, SIDEBAR.min, SIDEBAR.max) }),
      // Sanity only: the px floor depends on window width, so the dragger
      // applies it — it is the one that can measure the container.
      setRequestSplit: (fraction) => set({ requestSplit: clamp(fraction, 0.05, 0.95) }),
      moveRequestTab: (from, to) =>
        set((s) => {
          const rest = s.requestTabs.filter((t) => t !== from)
          const at = rest.indexOf(to)
          if (from === to || at === -1) return s
          // Drop before the neighbour when coming from the right, after when
          // from the left — that lands the tab under the cursor, not beside it.
          const before = s.requestTabs.indexOf(from) > s.requestTabs.indexOf(to)
          rest.splice(before ? at : at + 1, 0, from)
          return { requestTabs: rest }
        }),
      resetSidebar: () => set({ sidebarWidth: SIDEBAR.default }),
      resetSplit: () => set({ requestSplit: SPLIT_DEFAULT }),
      resetRequestTabs: () => set({ requestTabs: REQUEST_TABS }),
    }),
    {
      name: 'somnolent-layout',
      // Preferences only: storing the functions too buys nothing and invites a
      // strange rehydration.
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        requestSplit: s.requestSplit,
        requestTabs: s.requestTabs,
      }),
      merge: (persisted, current) => ({ ...current, ...sanitizeLayout(persisted) }),
    },
  ),
)
