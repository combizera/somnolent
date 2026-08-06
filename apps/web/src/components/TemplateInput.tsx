import { useRef } from 'react'

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
 * resolve a variável, vermelho quando ela não existe.
 */
export function TemplateInput({ value, onChange, ctx, placeholder, className = '' }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

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
        className="pointer-events-none absolute inset-0 overflow-hidden px-3 py-2 font-mono text-xs leading-5 whitespace-pre text-ink"
      >
        {parts}
      </div>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (overlayRef.current) overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
        }}
        spellCheck={false}
        className="w-full bg-transparent px-3 py-2 font-mono text-xs leading-5 text-transparent caret-ink placeholder:text-ink-faint focus:outline-none"
      />
    </div>
  )
}
