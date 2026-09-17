import { useEffect, useState } from 'react'
import { CircleHelp, X } from 'lucide-react'

/** Help examples, over a bookstore API — the same ones Insomnia uses. */
const EXAMPLES: { path: string; what: string }[] = [
  { path: '$.store.books[*].title', what: 'the title of every book' },
  { path: '$.store.books[?(@.price < 10)].title', what: 'the books under 10' },
  { path: '$.store.books[-1:]', what: 'the last book' },
  { path: '$.store.books.length', what: 'how many books there are' },
]

function Help({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      {/* Clicking outside closes, without dimming the screen behind. */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="JSONPath filter help"
        className="absolute right-2 bottom-10 z-50 w-96 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-panel p-3 shadow-lg"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-ink-dim">
            Use JSONPath to filter the response body. On a bookstore API:
          </p>
          <button
            onClick={onClose}
            aria-label="Close help"
            className="-mt-0.5 shrink-0 rounded p-0.5 text-ink-faint transition hover:bg-raised hover:text-ink"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
        <dl className="mt-2 flex flex-col gap-1.5">
          {EXAMPLES.map((e) => (
            <div key={e.path} className="flex flex-col">
              <dt className="font-mono text-xs break-all text-ink">{e.path}</dt>
              <dd className="text-xs text-ink-faint">{e.what}</dd>
            </div>
          ))}
        </dl>
        <a
          href="https://www.npmjs.com/package/jsonpath-plus"
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 inline-block text-xs text-ink-dim underline transition hover:text-ink"
        >
          Full syntax (jsonpath-plus)
        </a>
      </div>
    </>
  )
}

/** Filter bar at the foot of the Body tab — only shows with JSON on screen. */
export function JsonPathBar({
  value,
  onChange,
  matches,
  error,
}: {
  value: string
  onChange: (value: string) => void
  matches: number | null
  error: string | null
}) {
  const [help, setHelp] = useState(false)

  return (
    <div className="relative flex h-9 shrink-0 items-center gap-2 border-t border-line px-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Esc is the short way back to the whole body.
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onChange('')
          }
        }}
        spellCheck={false}
        autoComplete="off"
        aria-label="JSONPath filter"
        aria-invalid={error !== null}
        placeholder="$.store.books[*].title"
        className={`min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-ink-faint ${
          error ? 'text-bad' : 'text-ink'
        }`}
      />
      {/* The error takes the count's place: a broken path has nothing to count. */}
      {error ? (
        <span className="shrink-0 text-xs text-bad">{error}</span>
      ) : (
        matches !== null && (
          <span className="shrink-0 text-xs text-ink-faint">
            {matches === 1 ? '1 result' : `${matches} results`}
          </span>
        )
      )}
      <button
        onClick={() => setHelp((open) => !open)}
        aria-label="JSONPath filter help"
        aria-expanded={help}
        className="shrink-0 rounded p-0.5 text-ink-faint transition hover:bg-raised hover:text-ink"
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </button>
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  )
}
