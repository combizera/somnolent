import { useState } from 'react'
import { Eye, EyeOff, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { duplicateEnvIds, duplicateVarIndexes } from '@somnolent/core'
import type { Environment, EnvironmentVariable } from '@somnolent/core'
import { useStore } from '../store'

const SWATCHES = ['#efa14e', '#e0525f', '#58ad4c', '#4f97e8', '#7c5cff', '#e06fb4']

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
            className={`rounded bg-transparent px-2 py-1 font-mono text-xs placeholder:text-ink-faint focus:outline-none ${
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
              className="w-full rounded bg-transparent px-2 py-1 font-mono text-xs text-ink placeholder:text-ink-faint focus:outline-none"
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
        <p className="px-1 py-0.5 text-[11px] text-bad">
          Chave repetida neste environment: no send só uma vale (a última). Renomeie ou remova a
          repetida.
        </p>
      )}
      <button
        onClick={() =>
          setVars([...env.variables, { key: '', value: '', secret: false, enabled: true }])
        }
        className="flex w-fit items-center gap-1 rounded px-2 py-1 text-xs text-ink-faint transition hover:bg-raised hover:text-ink"
      >
        <Plus className="size-3.5" />
        variável
      </button>
    </div>
  )
}

export function EnvManager({ onClose }: { onClose: () => void }) {
  const environments = useStore((s) => s.environments)
  const addEnvironment = useStore((s) => s.addEnvironment)
  const updateEnvironment = useStore((s) => s.updateEnvironment)
  const deleteEnvironment = useStore((s) => s.deleteEnvironment)
  const [selectedId, setSelectedId] = useState<string | null>(
    environments.find((e) => !e.isBase)?.id ?? environments[0]?.id ?? null,
  )

  const selected = environments.find((e) => e.id === selectedId) ?? null
  const dupeEnvIds = duplicateEnvIds(environments)
  const sorted = [...environments].sort((a, b) => Number(b.isBase) - Number(a.isBase))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[560px] w-full max-w-3xl overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
      >
        <div className="flex w-52 shrink-0 flex-col border-r border-line bg-app">
          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
            Environments
          </p>
          <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
            {sorted.map((env) => (
              <button
                key={env.id}
                onClick={() => setSelectedId(env.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                  env.id === selectedId ? 'bg-hover text-ink' : 'text-ink-dim hover:bg-raised'
                }`}
              >
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
                {env.isBase && <span className="ml-auto text-[10px] text-ink-faint">base</span>}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSelectedId(addEnvironment())}
            className="m-2 flex items-center justify-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs text-ink-dim transition hover:bg-raised hover:text-ink"
          >
            <Plus className="size-3.5" />
            environment
          </button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-line px-3 py-2.5">
            {selected && !selected.isBase ? (
              <>
                <input
                  value={selected.name}
                  spellCheck={false}
                  onChange={(e) => updateEnvironment(selected.id, { name: e.target.value })}
                  className={`rounded-md border bg-app px-2 py-1 text-sm font-medium text-ink focus:outline-none ${
                    dupeEnvIds.has(selected.id)
                      ? 'border-bad focus:border-bad'
                      : 'border-line focus:border-brand'
                  }`}
                />
                {dupeEnvIds.has(selected.id) && (
                  <span className="text-[11px] text-bad">
                    Já existe um environment com este nome.
                  </span>
                )}
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
                  onClick={() => {
                    if (confirm(`Excluir o environment "${selected.name}"?`)) {
                      deleteEnvironment(selected.id)
                      setSelectedId(environments.find((e) => e.isBase)?.id ?? null)
                    }
                  }}
                  className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-faint transition hover:bg-bad/10 hover:text-bad"
                >
                  <Trash2 className="size-3.5" />
                  excluir
                </button>
              </>
            ) : (
              <div>
                <p className="text-sm font-medium text-ink">Base</p>
                <p className="text-xs text-ink-faint">
                  Variáveis comuns a todos os environments. Cada environment pode sobrescrevê-las.
                </p>
              </div>
            )}
            <button
              onClick={onClose}
              className={`rounded px-2 py-1 text-ink-faint transition hover:bg-raised hover:text-ink ${
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
