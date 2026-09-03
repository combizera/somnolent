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
import { ResponsePanel } from './components/ResponsePanel'
import { ResizeHandle } from './components/ResizeHandle'
import { useActiveEnv, useSelectedRequest, useStore } from './store'
import { useSession } from './sessionStore'
import { PANE_MIN, SIDEBAR, useLayout } from './layoutStore'

/** Largura da coluna de cada divisor, em px. Entra direto no grid abaixo. */
const HANDLE = 5

function App() {
  const active = useActiveEnv()
  const request = useSelectedRequest()
  const openShare = useSession((s) => s.openShare)
  const selectRequest = useStore((s) => s.selectRequest)
  const openCollection = useStore((s) => s.openCollection)

  /** Logo é o "início": fecha a request e volta pra lista de collections. */
  const goHome = () => {
    selectRequest(null)
    openCollection(null)
  }
  // Cor do environment: sinal de contexto, não cor de interface.
  const envColor = active?.color ?? 'transparent'

  const main = useRef<HTMLElement>(null)
  const sidebarWidth = useLayout((s) => s.sidebarWidth)
  const requestSplit = useLayout((s) => s.requestSplit)
  const setSidebarWidth = useLayout((s) => s.setSidebarWidth)
  const setRequestSplit = useLayout((s) => s.setRequestSplit)
  const resetSidebar = useLayout((s) => s.resetSidebar)
  const resetSplit = useLayout((s) => s.resetSplit)

  /** Quanto sobra pra request + response depois da sidebar e dos divisores. */
  const paneArea = () => {
    const box = main.current?.getBoundingClientRect()
    if (!box) return null
    const handles = request ? HANDLE * 2 : HANDLE
    return { left: box.left, available: box.width - sidebarWidth - handles }
  }

  /**
   * O teto da sidebar não é só o SIDEBAR.max: numa janela estreita ela precisa
   * parar antes, pra request e response continuarem com PANE_MIN cada.
   */
  const applySidebar = (px: number) => {
    const box = main.current?.getBoundingClientRect()
    if (!box) return setSidebarWidth(px)
    const handles = request ? HANDLE * 2 : HANDLE
    const panesNeed = request ? PANE_MIN * 2 : PANE_MIN
    const roof = Math.min(SIDEBAR.max, box.width - handles - panesNeed)
    // Janela minúscula: respeita o piso da sidebar e deixa o resto apertar.
    setSidebarWidth(Math.min(px, Math.max(roof, SIDEBAR.min)))
  }

  const applySplit = (fraction: number) => {
    const area = paneArea()
    if (!area || area.available <= 0) return setRequestSplit(fraction)
    // Converte o piso em px em piso de fração. Se nem 2×PANE_MIN cabe, cai no
    // meio a meio em vez de travar num extremo.
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
        {/* faixa fina no topo — o único lugar onde a cor do environment pinta o app */}
      <div className="h-0.5 shrink-0 transition-colors" style={{ background: envColor }} />

        <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-line px-3">
          <div className="flex items-center gap-1">
            <button
              onClick={goHome}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-raised"
              title="Voltar para o início"
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
              title="Buscar request (Ctrl K)"
              aria-label="Buscar request"
            >
              <Search aria-hidden className="size-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ProjectSelector />
            <button
              onClick={() => openShare()}
              className="rounded-md border border-line bg-panel p-2 text-ink-dim transition hover:bg-raised hover:text-ink"
              title="Compartilhar este project"
              aria-label="Compartilhar este project"
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
          className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]"
          style={{
            gridTemplateColumns: request
              ? `${sidebarWidth}px ${HANDLE}px minmax(0,${requestSplit}fr) ${HANDLE}px minmax(0,${1 - requestSplit}fr)`
              : `${sidebarWidth}px ${HANDLE}px minmax(0,1fr)`,
          }}
        >
          <Sidebar />
          <ResizeHandle
            label="Largura da sidebar"
            onDrag={(clientX) => {
              const box = main.current?.getBoundingClientRect()
              if (box) applySidebar(clientX - box.left)
            }}
            onStep={(delta) => applySidebar(sidebarWidth + delta)}
            onReset={resetSidebar}
          />
          {request ? (
            <>
              <RequestPanel key={request.id} request={request} />
              <ResizeHandle
                label="Divisão entre request e response"
                onDrag={(clientX) => {
                  const area = paneArea()
                  // Sem o teste de `available`, uma janela degenerada dividiria
                  // por zero e gravaria NaN na fração.
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
        </main>
      </div>
    </ConfirmProvider>
  )
}

export default App
