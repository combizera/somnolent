import { Sidebar } from './components/Sidebar'
import { Search } from 'lucide-react'
import { EnvSelector } from './components/EnvSelector'
import { SyncPanel } from './components/SyncPanel'
import { CommandPalette } from './components/CommandPalette'
import { RequestPanel } from './components/RequestPanel'
import { ResponsePanel } from './components/ResponsePanel'
import { useActiveEnv, useSelectedRequest, useStore } from './store'

function App() {
  const active = useActiveEnv()
  const request = useSelectedRequest()
  const addRequest = useStore((s) => s.addRequest)
  // Cor do environment: sinal de contexto, não cor de interface.
  const envColor = active?.color ?? 'transparent'

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-app text-ink"
      style={{ '--accent': active?.color ?? 'var(--color-brand)' } as React.CSSProperties}
    >
      {/* faixa fina no topo — o único lugar onde a cor do environment pinta o app */}
      <div className="h-0.5 shrink-0 transition-colors" style={{ background: envColor }} />

      <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-line px-3">
        <div className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded-md bg-brand text-[11px] font-bold text-white">
            S
          </span>
          <span className="text-sm font-semibold">Somnolent</span>
        </div>

        <button
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
            )
          }}
          className="hidden min-w-64 items-center gap-2 rounded-md border border-line bg-panel px-3 py-1.5 text-xs text-ink-faint transition hover:border-line hover:bg-raised md:flex"
        >
          <Search aria-hidden className="size-3.5 shrink-0" />
          <span className="flex-1 text-left">Buscar request…</span>
          <kbd className="rounded border border-line bg-app px-1.5 py-px font-mono text-[10px]">
            Ctrl K
          </kbd>
        </button>

        <div className="flex items-center gap-2">
          <SyncPanel />
          <EnvSelector />
        </div>
      </header>

      <CommandPalette />

      <main className="grid min-h-0 flex-1 grid-cols-[272px_minmax(0,1fr)_minmax(0,1fr)]">
        <Sidebar />
        {request ? (
          <>
            <RequestPanel key={request.id} request={request} />
            <ResponsePanel key={`res-${request.id}`} requestId={request.id} />
          </>
        ) : (
          <div className="col-span-2 grid place-items-center bg-panel">
            <div className="text-center">
              <p className="text-sm text-ink-dim">Nenhuma request selecionada.</p>
              <button
                onClick={() => addRequest(null)}
                className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hi"
              >
                Criar request
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
