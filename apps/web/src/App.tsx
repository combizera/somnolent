import { useRef } from 'react'
import { Logo } from './components/Logo'
import { EmptyState } from './components/EmptyState'
import { Sidebar } from './components/Sidebar'
import { Search, Share2 } from 'lucide-react'
import { EnvSelector } from './components/EnvSelector'
import { ProjectSelector } from './components/ProjectSelector'
import { SyncPanel } from './components/SyncPanel'
import { ShareDialog } from './components/ShareDialog'
import { CommandPalette } from './components/CommandPalette'
import { ConfirmProvider } from './components/ConfirmDialog'
import { RequestPanel } from './components/RequestPanel'
import { TabStrip } from './components/TabStrip'
import { ResponsePanel } from './components/ResponsePanel'
import { ResizeHandle } from './components/ResizeHandle'
import { useActiveEnv, useSelectedRequest, useStore } from './store'
import { useSession } from './sessionStore'
import { PANE_MIN, SIDEBAR, useLayout } from './layoutStore'
import { headerButton } from './lib/ui'

/** Width of each divider column, in px. Goes straight into the grid below. */
const HANDLE = 5

function App() {
  const active = useActiveEnv()
  const request = useSelectedRequest()
  const openShare = useSession((s) => s.openShare)
  const selectRequest = useStore((s) => s.selectRequest)
  const openCollection = useStore((s) => s.openCollection)

  /** The logo is "home": closes the request and goes back to the collection list. */
  const goHome = () => {
    selectRequest(null)
    openCollection(null)
  }
  // Environment color: a context signal, not an interface color.
  const envColor = active?.color ?? 'transparent'

  const main = useRef<HTMLElement>(null)
  const sidebarWidth = useLayout((s) => s.sidebarWidth)
  const requestSplit = useLayout((s) => s.requestSplit)
  const setSidebarWidth = useLayout((s) => s.setSidebarWidth)
  const setRequestSplit = useLayout((s) => s.setRequestSplit)
  const resetSidebar = useLayout((s) => s.resetSidebar)
  const resetSplit = useLayout((s) => s.resetSplit)

  /** What is left for request + response after the sidebar and the dividers. */
  const paneArea = () => {
    const box = main.current?.getBoundingClientRect()
    if (!box) return null
    const handles = request ? HANDLE * 2 : HANDLE
    return { left: box.left, available: box.width - sidebarWidth - handles }
  }

  /** The sidebar ceiling is not just SIDEBAR.max: in a narrow window it has to
   *  stop earlier so request and response keep PANE_MIN each. */
  const applySidebar = (px: number) => {
    const box = main.current?.getBoundingClientRect()
    if (!box) return setSidebarWidth(px)
    const handles = request ? HANDLE * 2 : HANDLE
    const panesNeed = request ? PANE_MIN * 2 : PANE_MIN
    const roof = Math.min(SIDEBAR.max, box.width - handles - panesNeed)
    // Tiny window: honour the sidebar floor and let the rest squeeze.
    setSidebarWidth(Math.min(px, Math.max(roof, SIDEBAR.min)))
  }

  const applySplit = (fraction: number) => {
    const area = paneArea()
    if (!area || area.available <= 0) return setRequestSplit(fraction)
    // Turns the px floor into a fraction floor. If not even 2×PANE_MIN fits,
    // fall back to half and half instead of sticking to an extreme.
    const floor = PANE_MIN / area.available
    if (floor >= 0.5) return setRequestSplit(0.5)
    setRequestSplit(Math.min(Math.max(fraction, floor), 1 - floor))
  }

  return (
    <ConfirmProvider>
      <div
        className="flex h-screen flex-col overflow-hidden bg-app text-ink"
        style={{ '--accent': active?.color ?? 'var(--color-brand)' } as React.CSSProperties}
      >
        {/* thin top stripe — the only place the environment color paints the app */}
        <div className="h-0.5 shrink-0 transition-colors" style={{ background: envColor }} />

        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-3">
          <div className="flex items-center gap-1">
            <button
              onClick={goHome}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-raised"
              title="Back to home"
            >
              <Logo className="size-5 shrink-0" />
              <span className="text-sm font-semibold">Somnolent</span>
            </button>

            <button
              onClick={() => {
                window.dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
                )
              }}
              className="rounded-md p-2 text-ink-faint transition hover:bg-raised hover:text-ink"
              title="Search request (Ctrl K)"
              aria-label="Search request"
            >
              <Search aria-hidden className="size-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ProjectSelector />
            <button
              onClick={() => openShare()}
              className={`${headerButton} w-9 px-0`}
              title="Share this project"
              aria-label="Share this project"
            >
              <Share2 aria-hidden className="size-3.5" />
            </button>
            <SyncPanel />
            <EnvSelector />
          </div>
        </header>

        <CommandPalette />
        <ShareDialog />

        <main
          ref={main}
          className="grid min-h-0 flex-1"
          style={{
            // Two rows: the tab strip on top, the panels below. Only the sidebar
            // column changes, so this template no longer needs an open request.
            gridTemplateRows: 'auto minmax(0,1fr)',
            gridTemplateColumns: `${sidebarWidth}px ${HANDLE}px minmax(0,1fr)`,
          }}
        >
          <div
            style={{ gridRow: '1 / span 2', gridTemplateRows: 'minmax(0,1fr)' }}
            className="grid min-h-0 overflow-hidden"
          >
            <Sidebar />
          </div>
          <ResizeHandle
            label="Sidebar width"
            style={{ gridRow: '1 / span 2' }}
            onDrag={(clientX) => {
              const box = main.current?.getBoundingClientRect()
              if (box) applySidebar(clientX - box.left)
            }}
            onStep={(delta) => applySidebar(sidebarWidth + delta)}
            onReset={resetSidebar}
          />

          <TabStrip style={{ gridColumn: 3, gridRow: 1 }} />

          <div
            className="grid min-h-0"
            style={{
              // Explicit row and column: without the strip, auto-placement would
              // pull the panels to row 1, and an implicit row is `auto`.
              gridColumn: 3,
              gridRow: 2,
              gridTemplateRows: 'minmax(0,1fr)',
              gridTemplateColumns: request
                ? `minmax(0,${requestSplit}fr) ${HANDLE}px minmax(0,${1 - requestSplit}fr)`
                : 'minmax(0,1fr)',
            }}
          >
            {request ? (
              <>
                <RequestPanel key={request.id} request={request} />
                <ResizeHandle
                  label="Request and response split"
                  onDrag={(clientX) => {
                    const area = paneArea()
                    // Without the `available` check, a degenerate window would
                    // divide by zero and store NaN as the fraction.
                    if (area && area.available > 0) {
                      applySplit((clientX - area.left - sidebarWidth - HANDLE) / area.available)
                    }
                  }}
                  onStep={(delta) => {
                    const area = paneArea()
                    if (area && area.available > 0) {
                      applySplit(requestSplit + delta / area.available)
                    }
                  }}
                  onReset={resetSplit}
                />
                <ResponsePanel key={`res-${request.id}`} requestId={request.id} />
              </>
            ) : (
              <EmptyState />
            )}
          </div>
        </main>
      </div>
    </ConfirmProvider>
  )
}

export default App
