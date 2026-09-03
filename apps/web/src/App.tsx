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
import { useActiveEnv, useSelectedRequest, useStore } from './store'
import { useSession } from './sessionStore'

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

        <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] grid-cols-[272px_minmax(0,1fr)_minmax(0,1fr)]">
          <Sidebar />
          {request ? (
            <>
              <RequestPanel key={request.id} request={request} />
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
