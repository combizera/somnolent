import type { KeyValue } from '@somnolent/core'
import { Plus, X } from 'lucide-react'
import { TemplateInput } from './TemplateInput'

interface Props {
  items: KeyValue[]
  onChange: (items: KeyValue[]) => void
  ctx: Record<string, string>
  keyPlaceholder?: string
  valuePlaceholder?: string
}

export function KeyValueEditor({
  items,
  onChange,
  ctx,
  keyPlaceholder = 'Chave',
  valuePlaceholder = 'Valor',
}: Props) {
  const update = (id: string, patch: Partial<KeyValue>) =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  const remove = (id: string) => onChange(items.filter((it) => it.id !== id))

  const add = () =>
    onChange([...items, { id: crypto.randomUUID(), key: '', value: '', enabled: true }])

  return (
    <div className="flex flex-col gap-1">
      {items.length > 0 && (
        <div className="grid grid-cols-[28px_1fr_1.5fr_28px] items-center gap-1 px-1 pb-0.5 text-[10px] tracking-wider text-ink-faint uppercase">
          <span />
          <span>{keyPlaceholder}</span>
          <span>{valuePlaceholder}</span>
          <span />
        </div>
      )}
      {items.map((it) => (
        <div
          key={it.id}
          className={`group grid grid-cols-[28px_1fr_1.5fr_28px] items-center gap-1 rounded-md border border-line-soft bg-app transition hover:border-line ${
            it.enabled ? '' : 'opacity-45'
          }`}
        >
          <input
            type="checkbox"
            checked={it.enabled}
            onChange={(e) => update(it.id, { enabled: e.target.checked })}
            className="mx-auto accent-brand"
            title={it.enabled ? 'Desabilitar' : 'Habilitar'}
          />
          <TemplateInput
            value={it.key}
            onChange={(key) => update(it.id, { key })}
            ctx={ctx}
            placeholder={keyPlaceholder}
            className="border-r border-line-soft"
          />
          <TemplateInput
            value={it.value}
            onChange={(value) => update(it.id, { value })}
            ctx={ctx}
            placeholder={valuePlaceholder}
          />
          <button
            onClick={() => remove(it.id)}
            className="text-ink-faint opacity-0 transition group-hover:opacity-100 hover:text-bad"
            title="Remover"
            aria-label="Remover"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex w-fit items-center gap-1 rounded px-2 py-1 text-sm text-ink-faint transition hover:bg-raised hover:text-ink"
      >
        <Plus className="size-3.5" />
        adicionar
      </button>
    </div>
  )
}
