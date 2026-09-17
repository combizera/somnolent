import { useState } from 'react'
import type { KeyValue } from '@somnolent/core'
import { GripVertical, Plus, X } from 'lucide-react'
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
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
}: Props) {
  /** Row being dragged; dataTransfer cannot be read during dragover. */
  const [dragging, setDragging] = useState<string | null>(null)

  const update = (id: string, patch: Partial<KeyValue>) =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  const remove = (id: string) => onChange(items.filter((it) => it.id !== id))

  const add = () =>
    onChange([...items, { id: crypto.randomUUID(), key: '', value: '', enabled: true }])

  const move = (fromId: string, toId: string) => {
    if (fromId === toId) return
    const rest = items.filter((it) => it.id !== fromId)
    const row = items.find((it) => it.id === fromId)
    const at = rest.findIndex((it) => it.id === toId)
    if (!row || at === -1) return
    // Drop before the neighbour when coming from below, after when from above.
    const below = items.findIndex((it) => it.id === fromId) > items.findIndex((it) => it.id === toId)
    rest.splice(below ? at : at + 1, 0, row)
    onChange(rest)
  }

  return (
    <div className="flex flex-col gap-1">
      {items.length > 0 && (
        <div className="grid grid-cols-[20px_28px_1fr_1.5fr_28px] items-center gap-1 px-1 pb-0.5 text-[10px] tracking-wider text-ink-faint uppercase">
          <span />
          <span />
          <span>{keyPlaceholder}</span>
          <span>{valuePlaceholder}</span>
          <span />
        </div>
      )}
      {items.map((it) => (
        <div
          key={it.id}
          // Only the grip is draggable: a draggable row would break selecting
          // text inside the inputs.
          onDragOver={(e) => {
            if (!dragging) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragging) move(dragging, it.id)
            setDragging(null)
          }}
          className={`group grid grid-cols-[20px_28px_1fr_1.5fr_28px] items-center gap-1 rounded-md border border-line-soft bg-app transition hover:border-line ${
            it.enabled ? '' : 'opacity-45'
          } ${dragging === it.id ? 'opacity-40' : ''}`}
        >
          <button
            draggable
            onDragStart={(e) => {
              setDragging(it.id)
              e.dataTransfer.effectAllowed = 'move'
              // Firefox needs a payload or the drag never starts.
              e.dataTransfer.setData('text/plain', it.id)
            }}
            onDragEnd={() => setDragging(null)}
            title="Reorder"
            aria-label="Reorder"
            className="flex cursor-grab items-center justify-center text-ink-faint opacity-0 transition group-hover:opacity-100 hover:text-ink active:cursor-grabbing"
          >
            <GripVertical aria-hidden className="size-3.5" />
          </button>
          <input
            type="checkbox"
            checked={it.enabled}
            onChange={(e) => update(it.id, { enabled: e.target.checked })}
            className="mx-auto accent-brand"
            title={it.enabled ? 'Disable' : 'Enable'}
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
            title="Remove"
            aria-label="Remove"
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
        Add
      </button>
    </div>
  )
}
