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
      <div className="grid grid-cols-[28px_1fr_1.4fr_58px_28px] items-center gap-2 px-1 text-[10px] tracking-wider text-ink-faint uppercase">
        <span />
        <span>chave</span>
        <span>valor</span>
        <span className="text-center">secreta</span>
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
            title={v.enabled ? 'Desabilitar' : 'Habilitar'}
          />
          <input
            value={v.key}
            placeholder="base_url"
            spellCheck={false}
            onChange={(e) => update(i, { key: e.target.value })}
            title={
              dupeIndexes.has(i)
                ? `Já existe outra variável "${v.key}" neste environment. Só uma vale no send — renomeie ou remova a repetida.`
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
              placeholder="valor"
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
                title={revealed.has(i) ? 'Ocultar valor' : 'Mostrar valor'}
                aria-label={revealed.has(i) ? 'Ocultar valor' : 'Mostrar valor'}
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
            title="Secreta: o valor não vai pro sync, fica só nesta máquina"
          />
          <button
            onClick={() => setVars(env.variables.filter((_, j) => j !== i))}
            className="mx-auto text-ink-faint hover:text-bad"
            title="Remover variável"
            aria-label="Remover variável"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {dupeIndexes.size > 0 && (
        <p className="px-1 py-0.5 text-xs text-bad">
          Chave repetida neste environment: no send só uma vale (a última). Renomeie ou remova a
          repetida.
        </p>
      )}
      <button
        onClick={() =>
          setVars([...env.variables, { key: '', value: '', secret: false, enabled: true }])
        }
        className="flex w-fit items-center gap-1 rounded px-2 py-1 text-sm text-ink-faint transition hover:bg-raised hover:text-ink"
      >
        <Plus className="size-3.5" />
        variável
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
  // Environments desta collection — outra collection tem os seus.
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
  // A ordem é a que a pessoa arrastou; o base não fica mais preso no topo.
  const sorted = [...environments].sort(bySortOrder)

  /** Índice do slot vira índice na lista sem o item arrastado. */
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
              className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase"
              title="Arraste para reordenar"
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
              // Soltar no espaço vazio embaixo joga pro fim da lista.
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
                  <span className="ml-auto flex shrink-0 items-center" title="Nome repetido">
                    <TriangleAlert aria-label="Nome repetido" className="size-3.5 text-bad" />
                  </span>
                )}
                {env.isBase && (
                  <span
                    className="ml-auto shrink-0 text-[10px] text-ink-faint"
                    title="Environment base: aplicado antes do ativo, em todos os outros"
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
            environment
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
                    Já existe um environment com este nome.
                  </span>
                )}

                {selected.isBase ? (
                  // O base nunca é o ativo, então não tem cor de destaque nem exclusão.
                  <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink-faint">
                    <span className="mr-1.5 rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-dim">
                      base
                    </span>
                    Variáveis comuns a todos os environments — cada um pode sobrescrevê-las. O nome
                    é só rótulo: este environment não aparece no seletor do topo.
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
                          title="Cor do environment"
                        />
                      ))}
                    </div>
                    <button
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Excluir o environment "${selected.name}"?`,
                          message: 'As variáveis dele se perdem, inclusive as secretas.',
                          confirmLabel: 'Excluir environment',
                          danger: true,
                        })
                        if (!ok) return
                        deleteEnvironment(selected.id)
                        setSelectedId(environments.find((e) => e.isBase)?.id ?? null)
                      }}
                      className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-sm text-ink-faint transition hover:bg-bad/10 hover:text-bad"
                    >
                      <Trash2 className="size-3.5" />
                      excluir
                    </button>
                  </>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-faint">Selecione um environment.</p>
            )}
            <button
              onClick={onClose}
              className={`shrink-0 rounded px-2 py-1 text-ink-faint transition hover:bg-raised hover:text-ink ${
                selected && !selected.isBase ? '' : 'ml-auto'
              }`}
              title="Fechar"
              aria-label="Fechar"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-3">
            {selected ? (
              <VariableRows env={selected} />
            ) : (
              <p className="text-sm text-ink-faint">Selecione um environment.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
