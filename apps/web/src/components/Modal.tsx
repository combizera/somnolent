import { useState } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { fieldLabel, inputClass, selectClass } from '../lib/ui'

export function Modal({
  onClose,
  children,
  /** Diálogo empilhado sobre outro modal precisa vir na frente. */
  layer = 'z-50',
}: {
  onClose: () => void
  children: React.ReactNode
  layer?: string
}) {
  return (
    <div
      className={`fixed inset-0 ${layer} flex items-center justify-center bg-black/70 p-6`}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg border border-line bg-panel p-5 shadow-2xl"
      >
        {children}
      </div>
    </div>
  )
}

/** Campo somente-leitura com botão de copiar — usado pra chave e pro link. */
export function CopyField({ value, hint }: { value: string; hint: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-stretch gap-1">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`${inputClass} font-mono text-sm`}
        />
        <button
          onClick={() => {
            void navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <p className="text-sm text-ink-faint">{hint}</p>
    </div>
  )
}

/** Rótulo + controle + dica, com o espaçamento igual em todos os diálogos. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className={fieldLabel}>{label}</span>
      {children}
      {hint && <span className="text-sm text-ink-faint">{hint}</span>}
    </label>
  )
}

/** Select no idioma do app: chevron sobreposto, nunca o controle nativo. */
export function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <span className="relative block">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-faint"
      />
    </span>
  )
}
