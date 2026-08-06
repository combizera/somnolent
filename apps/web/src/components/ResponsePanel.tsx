import { useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { useStore, type HistoryEntry } from '../store'
import { useSession } from '../sessionStore'
import { formatSize, formatTime } from '../lib/send'

type Tab = 'body' | 'headers' | 'history'

const NO_HISTORY: HistoryEntry[] = []

/** Faixa de status → cor semântica (independente da marca e do environment). */
function statusChip(status: number) {
  if (status < 300) return 'bg-ok/20 text-ok'
  if (status < 400) return 'bg-info/20 text-info'
  if (status < 500) return 'bg-warn/20 text-warn'
  return 'bg-bad/20 text-bad'
}

function statusText(status: number) {
  if (status < 300) return 'text-ok'
  if (status < 400) return 'text-info'
  if (status < 500) return 'text-warn'
  return 'text-bad'
}

function prettyBody(body: string): { text: string; isJson: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(body), null, 2), isJson: true }
  } catch {
    return { text: body, isJson: false }
  }
}

interface View {
  status: number
  statusText: string
  timeMs: number
  sizeBytes: number
  headers: { key: string; value: string }[]
  body: string
  at?: string
}

export function ResponsePanel({ requestId }: { requestId: string }) {
  const response = useSession((s) => s.responses[requestId])
  const sending = useSession((s) => s.sending[requestId] ?? false)
  const history = useStore((s) => s.history[requestId] ?? NO_HISTORY)
  const clearHistory = useStore((s) => s.clearHistory)
  const [tab, setTab] = useState<Tab>('body')
  const [viewingId, setViewingId] = useState<string | null>(null)

  const viewingEntry: HistoryEntry | null =
    viewingId !== null ? (history.find((h) => h.id === viewingId) ?? null) : null

  const view: View | null = viewingEntry ? viewingEntry : response?.ok ? response : null

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'body', label: 'Body' },
    { id: 'headers', label: 'Headers', count: view?.headers.length },
    { id: 'history', label: 'Histórico', count: history.length },
  ]

  return (
    <section className="flex h-full min-w-0 flex-col border-l border-line bg-panel">
      {/* barra de status */}
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-xs">
        {sending && <span className="animate-pulse text-ink-dim">enviando…</span>}
        {!sending && view && (
          <>
            <span
              className={`rounded px-2 py-0.5 font-mono text-[11px] font-bold ${statusChip(view.status)}`}
            >
              {view.status} {view.statusText}
            </span>
            <span className="rounded bg-raised px-2 py-0.5 font-mono text-[11px] text-ink-dim">
              {formatTime(view.timeMs)}
            </span>
            <span className="rounded bg-raised px-2 py-0.5 font-mono text-[11px] text-ink-dim">
              {formatSize(view.sizeBytes)}
            </span>
            {viewingEntry && (
              <button
                onClick={() => setViewingId(null)}
                className="ml-auto rounded bg-raised px-2 py-0.5 text-[11px] text-ink-dim transition hover:text-ink"
                title="Voltar para a response mais recente"
              >
                vendo histórico ✕
              </button>
            )}
          </>
        )}
        {!sending && !view && response && !response.ok && (
          <span className="rounded bg-bad/20 px-2 py-0.5 font-mono text-[11px] font-bold text-bad">
            falhou
          </span>
        )}
        {!sending && !view && (!response || response.ok) && (
          <span className="text-ink-faint">sem response ainda</span>
        )}
      </header>

      {response && !response.ok && !viewingEntry ? (
        <div className="p-3">
          <p className="rounded-md border border-bad/40 bg-bad/10 p-3 text-sm leading-relaxed text-bad">
            {response.message}
          </p>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 gap-4 border-b border-line px-4">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 py-2 text-xs font-medium transition ${
                  tab === t.id
                    ? 'border-brand text-ink'
                    : 'border-transparent text-ink-dim hover:text-ink'
                }`}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className="rounded bg-raised px-1.5 py-px font-mono text-[10px] text-ink-dim">
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'body' &&
              (view ? (
                (() => {
                  const { text, isJson } = prettyBody(view.body)
                  return (
                    <CodeMirror
                      value={text}
                      readOnly
                      extensions={isJson ? [json()] : []}
                      theme="dark"
                      height="100%"
                      style={{ height: '100%' }}
                    />
                  )
                })()
              ) : (
                <p className="p-4 text-sm text-ink-faint">
                  Aperte <span className="font-semibold text-ink-dim">Enviar</span> para ver a
                  response aqui.
                </p>
              ))}

            {tab === 'headers' && (
              <div className="p-3">
                {view && view.headers.length > 0 ? (
                  <table className="w-full font-mono text-xs">
                    <tbody>
                      {view.headers.map((h, i) => (
                        <tr key={i} className="border-b border-line-soft">
                          <td className="py-1.5 pr-4 align-top whitespace-nowrap text-ink-dim">
                            {h.key}
                          </td>
                          <td className="py-1.5 break-all text-ink">{h.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-ink-faint">Sem headers para mostrar.</p>
                )}
              </div>
            )}

            {tab === 'history' && (
              <div className="p-3">
                {history.length === 0 ? (
                  <p className="text-sm text-ink-faint">
                    Cada envio desta request fica registrado aqui.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      {history.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => {
                            setViewingId(h.id)
                            setTab('body')
                          }}
                          className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left font-mono text-xs transition ${
                            viewingId === h.id
                              ? 'border-brand/50 bg-raised'
                              : 'border-line-soft bg-app hover:bg-raised'
                          }`}
                        >
                          <span className={`font-bold ${statusText(h.status)}`}>{h.status}</span>
                          <span className="min-w-0 flex-1 truncate text-ink-dim">
                            {h.method} {h.url}
                          </span>
                          <span className="shrink-0 text-ink-faint">{formatTime(h.timeMs)}</span>
                          <span className="shrink-0 text-ink-faint">
                            {new Date(h.at).toLocaleTimeString()}
                          </span>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        clearHistory(requestId)
                        setViewingId(null)
                      }}
                      className="mt-3 rounded px-2 py-1 text-xs text-ink-faint transition hover:bg-raised hover:text-ink"
                    >
                      limpar histórico
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
