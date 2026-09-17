import { useMemo, useRef, useState } from 'react'
import { Check, ChevronsDownUp, ChevronsUpDown, Copy, X } from 'lucide-react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { foldAll, unfoldAll } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { codeTheme } from '../lib/codeTheme'
import { applyJsonPath } from '../lib/jsonPath'
import { jsonFold } from '../lib/jsonFold'
import { JsonPathBar } from './JsonPathBar'
import { copyText } from '../lib/clipboard'
import { useStore, type HistoryEntry } from '../store'
import { useSession } from '../sessionStore'
import { formatSize, formatTime } from '../lib/send'

type Tab = 'body' | 'headers' | 'history'

const NO_HISTORY: HistoryEntry[] = []

const WRAP = EditorView.lineWrapping

/** Status band → semantic color (independent of brand and environment). */
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

/** `data` travels along so the filter does not re-parse on every keystroke. */
function prettyBody(body: string): { text: string; isJson: boolean; data: unknown } {
  try {
    const data: unknown = JSON.parse(body)
    return { text: JSON.stringify(data, null, 2), isJson: true, data }
  } catch {
    return { text: body, isJson: false, data: null }
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
  const [copied, setCopied] = useState(false)
  // The panel remounts per request (`key` at the caller), so the filter already
  // starts empty when switching tabs.
  const [filter, setFilter] = useState('')
  const editor = useRef<ReactCodeMirrorRef>(null)

  const viewingEntry: HistoryEntry | null =
    viewingId !== null ? (history.find((h) => h.id === viewingId) ?? null) : null

  const view: View | null = viewingEntry ? viewingEntry : response?.ok ? response : null

  // The memo is what gives `data` a stable identity; without it the filter memo
  // below would never hit.
  const pretty = useMemo(() => (view ? prettyBody(view.body) : null), [view])

  const filtered = useMemo(
    () =>
      pretty?.isJson
        ? applyJsonPath(pretty.data, pretty.text, filter)
        : { text: pretty?.text ?? '', matches: null, error: null },
    [pretty, filter],
  )

  const copy = async () => {
    if (!pretty) return
    // With a filter in the bar, the slice is what matters.
    await copyText(filtered.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Folding one by one is useless in a list of a thousand: the button acts on
  // the whole document, and each row's arrow still opens what matters.
  const fold = (all: boolean) => {
    const view = editor.current?.view
    if (view) (all ? foldAll : unfoldAll)(view)
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'body', label: 'Body' },
    { id: 'headers', label: 'Headers', count: view?.headers.length },
    { id: 'history', label: 'History', count: history.length },
  ]

  return (
    <section className="flex h-full min-w-0 flex-col border-l border-line bg-panel">
      {/* status bar */}
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-sm">
        {sending && <span className="animate-pulse text-ink-dim">Sending…</span>}
        {!sending && view && (
          <>
            <span
              className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${statusChip(view.status)}`}
            >
              {view.status} {view.statusText}
            </span>
            <span className="rounded bg-raised px-2 py-0.5 font-mono text-xs text-ink-dim">
              {formatTime(view.timeMs)}
            </span>
            <span className="rounded bg-raised px-2 py-0.5 font-mono text-xs text-ink-dim">
              {formatSize(view.sizeBytes)}
            </span>
            {viewingEntry && (
              <button
                onClick={() => setViewingId(null)}
                className="ml-auto flex items-center gap-1 rounded bg-raised px-2 py-0.5 text-xs text-ink-dim transition hover:text-ink"
                title="Back to the latest response"
              >
                Viewing history
                <X className="size-3" />
              </button>
            )}
          </>
        )}
        {!sending && !view && response && !response.ok && (
          <span className="rounded bg-bad/20 px-2 py-0.5 font-mono text-xs font-bold text-bad">
            Failed
          </span>
        )}
        {!sending && !view && (!response || response.ok) && (
          <span className="text-ink-faint">No response yet</span>
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
                className={`-mb-px flex items-center gap-1.5 border-b-2 py-2 text-sm font-medium transition ${
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

            {pretty?.isJson && tab === 'body' && (
              <div className="my-1 ml-auto flex shrink-0 items-center self-center">
                <button
                  onClick={() => fold(true)}
                  className="flex items-center rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink"
                  title="Collapse all"
                  aria-label="Collapse all"
                >
                  <ChevronsDownUp aria-hidden className="size-3.5" />
                </button>
                <button
                  onClick={() => fold(false)}
                  className="flex items-center rounded p-1 text-ink-faint transition hover:bg-raised hover:text-ink"
                  title="Expand all"
                  aria-label="Expand all"
                >
                  <ChevronsUpDown aria-hidden className="size-3.5" />
                </button>
              </div>
            )}

            {pretty && filtered.text.length > 0 && (
              <button
                onClick={copy}
                className={`my-1 flex shrink-0 items-center gap-1 self-center rounded px-2 py-1 text-xs text-ink-faint transition hover:bg-raised hover:text-ink ${
                  pretty.isJson && tab === 'body' ? '' : 'ml-auto'
                }`}
                title="Copy what is on screen"
              >
                {copied ? (
                  <>
                    <Check className="size-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    Copy
                  </>
                )}
              </button>
            )}
          </div>

          {tab === 'body' &&
            (pretty ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {/* overflow-hidden, not auto: the .cm-scroller is what scrolls.
                    Two nested scroll containers cancel each other out. */}
                <div className="min-h-0 flex-1 overflow-hidden">
                  <CodeMirror
                    value={filtered.text}
                    readOnly
                    // Wrap instead of opening a horizontal scroll: a response on
                    // one giant line is the rule, not the exception.
                    extensions={
                      pretty.isJson ? [json(), jsonFold, WRAP, codeTheme] : [WRAP, codeTheme]
                    }
                    ref={editor}
                    theme="none"
                    height="100%"
                    style={{ height: '100%' }}
                  />
                </div>
                {pretty.isJson && (
                  <JsonPathBar
                    value={filter}
                    onChange={setFilter}
                    matches={filtered.matches}
                    error={filtered.error}
                  />
                )}
              </div>
            ) : (
              <p className="p-4 text-sm text-ink-faint">
                Hit <span className="font-semibold text-ink-dim">Send</span> to see the
                response here.
              </p>
            ))}

          {tab === 'headers' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {view && view.headers.length > 0 ? (
                  <table className="w-full font-mono text-sm">
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
                  <p className="text-sm text-ink-faint">No headers to show.</p>
                )}
              </div>
            )}

          {tab === 'history' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {history.length === 0 ? (
                  <p className="text-sm text-ink-faint">
                    Every send of this request is recorded here.
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
                          className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left font-mono text-sm transition ${
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
                      className="mt-3 rounded px-2 py-1 text-sm text-ink-faint transition hover:bg-raised hover:text-ink"
                    >
                      Clear history
                    </button>
                  </>
                )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
