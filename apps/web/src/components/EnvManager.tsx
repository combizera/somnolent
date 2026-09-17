import { useState } from 'react'
import { Eye, EyeOff, GripVertical, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { duplicateEnvIds, duplicateVarIndexes } from '@somnolent/core'
import type { Environment, EnvironmentVariable } from '@somnolent/core'
import { bySortOrder, useCollectionEnvs, useStore } from '../store'
import { useConfirm } from '../lib/confirm'

const SWATCHES = ['#efa14e', '#e0525f', '#58ad4c', '#4f97e8', '#7c5cff', '#e06fb4']

const DROP_LINE = 'pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-brand'

function VariableRows({ env }: { env: Environment }) {
  const updateEnvironment = useStore((s) => s.updateEnvironment)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())

  const setVars = (variables: EnvironmentVariable[]) => updateEnvironment(env.id, { variables })
  const dupeIndexes = duplicateVarIndexes(env.variables)

  const update = (i: number, patch: Partial<EnvironmentVariable>) =>
    setVars(env.variables.map((v, j) => (j === i ? { ...v, ...patch } : v)))

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[28px_1fr_1.4fr_58px_28px] items-center gap-2 px-1 text-xs tracking-wider text-ink-faint uppercase">
        <span />
        <span>key</span>
        <span>value</span>
        <span className="text-center">secret</span>
        <span />
      </div>
      {env.variables.map((v, i) => (
        <div
          key={i}
          className={`grid grid-cols-[28px_1fr_1.4fr_58px_28px] items-center gap-2 rounded-md border bg-app py-1 transition ${
            dupeIndexes.has(i) ? 'border-bad' : 'border-line-soft hover:border-line'
          } ${v.enabled ? '' : 'opacity-45'}`}
        >
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
            className="mx-auto accent-brand"
            title={v.enabled ? 'Disable' : 'Enable'}
          />
          <input
            value={v.key}
            placeholder="base_url"
            spellCheck={false}
            onChange={(e) => update(i, { key: e.target.value })}
            title={
              dupeIndexes.has(i)
                ? `Another variable "${v.key}" already exists in this environment. Only one counts on send — rename or remove the duplicate.`
                : undefined
            }
            className={`rounded bg-transparent px-2 py-1 font-mono text-sm placeholder:text-ink-faint focus:outline-none ${
              dupeIndexes.has(i) ? 'text-bad' : 'text-ink'
            }`}
          />
          <div className="flex items-center gap-1">
            <input
              value={v.value}
              type={v.secret && !revealed.has(i) ? 'password' : 'text'}
              placeholder="Value"
              spellCheck={false}
              onChange={(e) => update(i, { value: e.target.value })}
              className="w-full rounded bg-transparent px-2 py-1 font-mono text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
            {v.secret && (
              <button
                onClick={() =>
                  setRevealed((prev) => {
                    const next = new Set(prev)
                    if (next.has(i)) next.delete(i)
                    else next.add(i)
                    return next
                  })
                }
                className="shrink-0 px-1 text-ink-faint hover:text-ink"
                title={revealed.has(i) ? 'Hide value' : 'Show value'}
                aria-label={revealed.has(i) ? 'Hide value' : 'Show value'}
              >
                {revealed.has(i) ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </button>
            )}
          </div>
          <input
            type="checkbox"
            checked={v.secret}
            onChange={(e) => update(i, { secret: e.target.checked })}
            className="mx-auto accent-brand"
            title="Secret: the value never syncs, it stays on this machine"
          />
          <button
            onClick={() => setVars(env.variables.filter((_, j) => j !== i))}
            className="mx-auto text-ink-faint hover:text-bad"
            title="Remove variable"
            aria-label="Remove variable"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {dupeIndexes.size > 0 && (
        <p className="px-1 py-0.5 text-xs text-bad">
          Duplicate key in this environment: only one counts on send (the last). Rename or remove
          the duplicate.
        </p>
      )}
      <button
        onClick={() =>
          setVars([...env.variables, { key: '', value: '', secret: false, enabled: true }])
        }
        className="flex w-fit items-center gap-1 rounded px-2 py-1 text-sm text-ink-faint transition hover:bg-raised hover:text-ink"
      >
        <Plus className="size-3.5" />
        Variable
      </button>
    </div>
  )
}

export function EnvManager({
  collectionId,
  collectionName,
  onClose,
}: {
  collectionId: string
  collectionName: string
  onClose: () => void
}) {
  // This collection's environments — another collection has its own.
  const environments = useCollectionEnvs(collectionId)
  const addEnvironment = useStore((s) => s.addEnvironment)
  const updateEnvironment = useStore((s) => s.updateEnvironment)
  const deleteEnvironment = useStore((s) => s.deleteEnvironment)
  const moveEnvironment = useStore((s) => s.moveEnvironment)
  const confirm = useConfirm()
  const [selectedId, setSelectedId] = useState<string | null>(
    environments.find((e) => !e.isBase)?.id ?? environments[0]?.id ?? null,
  )
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  const selected = environments.find((e) => e.id === selectedId) ?? null
  const dupeEnvIds = duplicateEnvIds(environments)
  // The order is the one dragged; the base one is no longer pinned to the top.
  const sorted = [...environments].sort(bySortOrder)

  /** The slot index becomes an index in the list without the dragged item. */
  const commitDrop = (slot: number) => {
    if (dragId) {
      const from = sorted.findIndex((e) => e.id === dragId)
      if (from >= 0 && slot !== from && slot !== from + 1) {
        moveEnvironment(dragId, slot > from ? slot - 1 : slot)
      }
    }
    setDragId(null)
    setDropAt(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[620px] w-full max-w-5xl overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
      >
        <div className="flex w-60 shrink-0 flex-col border-r border-line bg-app">
          <div className="flex flex-col gap-0.5 px-3 pt-3 pb-1">
            <p
              className="text-xs font-semibold tracking-wider text-ink-faint uppercase"
              title="Drag to reorder"
            >
              Environments
            </p>
            <p className="truncate text-xs text-ink-dim" title={collectionName}>
              {collectionName}
            </p>
          </div>
          <div
            className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2"
            onDragOver={(e) => {
              // Dropping on the empty space below sends it to the end of the list.
              if (!dragId) return
              e.preventDefault()
              if (dropAt !== sorted.length) setDropAt(sorted.length)
            }}
            onDrop={(e) => {
              if (!dragId) return
              e.preventDefault()
              commitDrop(sorted.length)
            }}
          >
            {sorted.map((env, i) => (
              <div
                key={env.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', env.id)
                  setDragId(env.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setDropAt(null)
                }}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'move'
                  const rect = e.currentTarget.getBoundingClientRect()
                  const next = e.clientY < rect.top + rect.height / 2 ? i : i + 1
                  if (dropAt !== next) setDropAt(next)
                }}
                onDrop={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  commitDrop(e.clientY < rect.top + rect.height / 2 ? i : i + 1)
                }}
                onClick={() => setSelectedId(env.id)}
                className={`group relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                  env.id === selectedId ? 'bg-hover text-ink' : 'text-ink-dim hover:bg-raised'
                } ${dragId === env.id ? 'opacity-40' : ''}`}
              >
                {dropAt === i && <span className={`${DROP_LINE} -top-px`} />}
                {dropAt === i + 1 && <span className={`${DROP_LINE} -bottom-px`} />}
                <GripVertical
                  aria-hidden
                  className="size-3 shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100"
                />
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    background: env.isBase ? 'var(--color-ink-faint)' : (env.color ?? '#7c5cff'),
                  }}
                />
                <span className={`truncate ${dupeEnvIds.has(env.id) ? 'text-bad' : ''}`}>
                  {env.name}
                </span>
                {dupeEnvIds.has(env.id) && (
                  <span className="ml-auto flex shrink-0 items-center" title="Duplicate name">
                    <TriangleAlert aria-label="Duplicate name" className="size-3.5 text-bad" />
                  </span>
                )}
                {env.isBase && (
                  <span
                    className="ml-auto shrink-0 text-xs text-ink-faint"
                    title="Base environment: applied before the active one, under all of them"
                  >
                    base
                  </span>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => setSelectedId(addEnvironment(collectionId))}
            className="m-2 flex items-center justify-center gap-1 rounded-md border border-line px-2 py-1.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
          >
            <Plus className="size-3.5" />
            Environment
          </button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-line px-3 py-2.5">
            {selected ? (
              <>
                <input
                  value={selected.name}
                  spellCheck={false}
                  onChange={(e) => updateEnvironment(selected.id, { name: e.target.value })}
                  className={`w-48 rounded-md border bg-app px-2 py-1 text-sm font-medium text-ink focus:outline-none ${
                    dupeEnvIds.has(selected.id)
                      ? 'border-bad focus:border-bad'
                      : 'border-line focus:border-brand'
                  }`}
                />
                {dupeEnvIds.has(selected.id) && (
                  <span className="text-xs text-bad">
                    An environment with this name already exists.
                  </span>
                )}

                {selected.isBase ? (
                  // The base is never the active one, so no accent color and no delete.
                  <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink-faint">
                    <span className="mr-1.5 rounded bg-raised px-1.5 py-0.5 text-xs text-ink-dim">
                      base
                    </span>
                    Variables shared by every environment — each one may override them. The name
                    is only a label: this environment never shows in the top picker.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      {SWATCHES.map((c) => (
                        <button
                          key={c}
                          onClick={() => updateEnvironment(selected.id, { color: c })}
                          className={`size-4 rounded-full transition ${
                            selected.color === c
                              ? 'ring-2 ring-ink ring-offset-2 ring-offset-panel'
                              : 'opacity-50 hover:opacity-100'
                          }`}
                          style={{ background: c }}
                          title="Environment color"
                        />
                      ))}
                    </div>
                    <button
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Delete the environment "${selected.name}"?`,
                          message: 'Its variables are lost, the secret ones included.',
                          confirmLabel: 'Delete environment',
                          danger: true,
                        })
                        if (!ok) return
                        deleteEnvironment(selected.id)
                        setSelectedId(environments.find((e) => e.isBase)?.id ?? null)
                      }}
                      className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-sm text-ink-faint transition hover:bg-bad/10 hover:text-bad"
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </button>
                  </>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-faint">Pick an environment.</p>
            )}
            <button
              onClick={onClose}
              className={`shrink-0 rounded px-2 py-1 text-ink-faint transition hover:bg-raised hover:text-ink ${
                selected && !selected.isBase ? '' : 'ml-auto'
              }`}
              title="Close"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-3">
            {selected ? (
              <VariableRows env={selected} />
            ) : (
              <p className="text-sm text-ink-faint">Pick an environment.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
