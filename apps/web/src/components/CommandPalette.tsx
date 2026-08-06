import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { MethodChip } from './MethodChip'

/** Busca global (Ctrl/Cmd+K): filtra requests por nome, URL e método. */
export function CommandPalette() {
  const requests = useStore((s) => s.requests)
  const collections = useStore((s) => s.collections)
  const selectRequest = useStore((s) => s.selectRequest)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
        setCursor(0)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    const list = q
      ? requests.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.url.toLowerCase().includes(q) ||
            r.method.toLowerCase() === q,
        )
      : requests
    return list.slice(0, 12)
  }, [query, requests])

  const pick = (id: string) => {
    selectRequest(id)
    setOpen(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, results.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            }
            if (e.key === 'Enter' && results[cursor]) pick(results[cursor].id)
          }}
          placeholder="Buscar request por nome, URL ou método…"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <div className="max-h-72 overflow-y-auto p-1">
          {results.length === 0 && (
            <p className="px-3 py-4 text-sm text-ink-faint">Nada encontrado.</p>
          )}
          {results.map((r, i) => {
            const folder = collections.find((c) => c.id === r.collectionId)?.name
            return (
              <button
                key={r.id}
                onClick={() => pick(r.id)}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                  i === cursor ? 'bg-hover text-ink' : 'text-ink-dim'
                }`}
              >
                <MethodChip method={r.method} />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {folder && <span className="shrink-0 text-xs text-ink-faint">{folder}</span>}
              </button>
            )
          })}
        </div>
        <p className="border-t border-line px-4 py-2 text-[10px] text-ink-faint">
          ↑↓ navega · Enter abre · Esc fecha
        </p>
      </div>
    </div>
  )
}
