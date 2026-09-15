import { useEffect, useState } from 'react'
import { CircleHelp, X } from 'lucide-react'

/** Os exemplos da ajuda, sobre uma API de livraria — os mesmos do Insomnia. */
const EXAMPLES: { path: string; what: string }[] = [
  { path: '$.store.books[*].title', what: 'o título de todos os livros' },
  { path: '$.store.books[?(@.price < 10)].title', what: 'os livros abaixo de 10' },
  { path: '$.store.books[-1:]', what: 'o último livro' },
  { path: '$.store.books.length', what: 'quantos livros há' },
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
      {/* Clique fora fecha, sem escurecer a tela por trás. */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Ajuda do filtro JSONPath"
        className="absolute right-2 bottom-10 z-50 w-96 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-panel p-3 shadow-lg"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-ink-dim">
            Use JSONPath para filtrar o body da response. Em uma API de livraria:
          </p>
          <button
            onClick={onClose}
            aria-label="Fechar ajuda"
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
          Sintaxe completa (jsonpath-plus)
        </a>
      </div>
    </>
  )
}

/** Barra de filtro no pé da aba Body — só aparece com JSON na tela. */
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
        // Esc é o caminho curto de volta pro body inteiro.
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onChange('')
          }
        }}
        spellCheck={false}
        autoComplete="off"
        aria-label="Filtro JSONPath"
        aria-invalid={error !== null}
        placeholder="$.store.books[*].title"
        className={`min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-ink-faint ${
          error ? 'text-bad' : 'text-ink'
        }`}
      />
      {/* Erro ocupa o lugar da contagem: path quebrado não tem o que contar. */}
      {error ? (
        <span className="shrink-0 text-xs text-bad">{error}</span>
      ) : (
        matches !== null && (
          <span className="shrink-0 text-xs text-ink-faint">
            {matches === 1 ? '1 resultado' : `${matches} resultados`}
          </span>
        )
      )}
      <button
        onClick={() => setHelp((open) => !open)}
        aria-label="Ajuda do filtro JSONPath"
        aria-expanded={help}
        className="shrink-0 rounded p-0.5 text-ink-faint transition hover:bg-raised hover:text-ink"
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </button>
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  )
}
