import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  completeToken,
  findOpenToken,
  rankVariables,
  type OpenToken,
} from '@somnolent/core'

const TOKEN = /(\{\{\s*[\w.-]+\s*\}\})/g
const NAME = /\{\{\s*([\w.-]+)\s*\}\}/

interface Props {
  value: string
  onChange: (value: string) => void
  ctx: Record<string, string>
  placeholder?: string
  className?: string
}

/**
 * Input com overlay que colore {{vars}}: roxo quando o environment ativo
 * resolve a variável, vermelho quando ela não existe. Abrir `{{` lista as
 * variáveis disponíveis.
 */
export function TemplateInput({ value, onChange, ctx, placeholder, className = '' }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [suggesting, setSuggesting] = useState<OpenToken | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Sem teto de itens: a lista rola. Cortar em N escondia variáveis sem avisar
  // (um `token` no fim do alfabeto simplesmente não aparecia).
  const names = suggesting ? rankVariables(Object.keys(ctx), suggesting.query) : []
  const open = suggesting !== null && names.length > 0

  // A lista é ancorada no input em coordenadas de viewport: ela vive num portal
  // pra não ser cortada pelos `overflow-hidden` dos grupos (URL, headers...).
  useLayoutEffect(() => {
    if (!open) return setRect(null)
    const measure = () => setRect(inputRef.current?.getBoundingClientRect() ?? null)
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  useEffect(() => {
    setHighlighted(0)
  }, [suggesting?.query])

  // Navegar com as setas não pode deixar o item destacado fora da área visível.
  useEffect(() => {
    listRef.current?.children[highlighted]?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  /** Reavalia o gatilho a partir do texto e da posição do caret. */
  const detect = (text: string, caret: number) => setSuggesting(findOpenToken(text, caret))

  const accept = (name: string) => {
    if (!suggesting || !inputRef.current) return
    const caret = inputRef.current.selectionStart ?? value.length
    const next = completeToken(value, caret, suggesting, name)

    onChange(next.text)
    setSuggesting(null)
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(next.caret, next.caret))
  }

  const parts = value.split(TOKEN).map((part, i) => {
    const name = part.match(NAME)?.[1]
    if (name === undefined) return <span key={i}>{part}</span>
    const known = ctx[name] !== undefined
    return (
      <span
        key={i}
        title={known ? ctx[name] : 'Variável não definida no environment ativo'}
        className={
          known
            ? 'rounded-sm bg-brand/15 text-brand-hi'
            : 'rounded-sm bg-bad/15 text-bad underline decoration-wavy decoration-bad/60'
        }
      >
        {part}
      </span>
    )
  })

  return (
    <div className={`relative min-w-0 ${className}`}>
      <div
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden px-3 py-2 font-mono text-sm leading-5 whitespace-pre text-ink"
      >
        {parts}
      </div>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlighted((h) => (h + 1) % names.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlighted((h) => (h - 1 + names.length) % names.length)
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            accept(names[highlighted] ?? names[0]!)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setSuggesting(null)
          }
        }}
        onKeyUp={(e) => {
          // setas e Home/End movem o caret sem disparar onChange
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
          }
        }}
        onClick={(e) => detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setSuggesting(null)}
        onScroll={(e) => {
          if (overlayRef.current) overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
        }}
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="w-full bg-transparent px-3 py-2 font-mono text-sm leading-5 text-transparent caret-ink placeholder:text-ink-faint focus:outline-none"
      />

      {open &&
        rect &&
        createPortal(
          <ul
            role="listbox"
            aria-label="Variáveis do environment"
            style={{
              position: 'fixed',
              top: rect.bottom + 4,
              left: rect.left,
              minWidth: Math.max(rect.width, 200),
              maxWidth: 380,
            }}
            ref={listRef}
            className="z-[60] max-h-64 overflow-y-auto rounded-md border border-line bg-panel py-1 shadow-2xl"
          >
            {names.map((name, i) => (
              <li key={name}>
                <button
                  type="button"
                  // mousedown: o blur do input chegaria antes de um click
                  onMouseDown={(e) => {
                    e.preventDefault()
                    accept(name)
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`flex w-full items-baseline gap-1 px-2.5 py-1.5 text-left font-mono text-sm whitespace-pre transition ${
                    i === highlighted ? 'bg-hover text-ink' : 'text-ink-dim'
                  }`}
                >
                  <span className="text-brand-hi/70">{'{{'}</span>
                  <span className="min-w-0 truncate">{name}</span>
                  <span className="text-brand-hi/70">{'}}'}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  )
}
