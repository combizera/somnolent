import { useState } from 'react'
import type { Environment, EnvironmentVariable } from '@somnolent/core'
import { useStore } from '../store'

const SWATCHES = ['#efa14e', '#e0525f', '#58ad4c', '#4f97e8', '#7c5cff', '#e06fb4']

function VariableRows({ env }: { env: Environment }) {
  const updateEnvironment = useStore((s) => s.updateEnvironment)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())

  const setVars = (variables: EnvironmentVariable[]) => updateEnvironment(env.id, { variables })

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
          className={`grid grid-cols-[28px_1fr_1.4fr_58px_28px] items-center gap-2 rounded-md border border-line-soft bg-app py-1 transition hover:border-line ${
            v.enabled ? '' : 'opacity-45'
          }`}
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
            className="rounded bg-transparent px-2 py-1 font-mono text-xs text-ink placeholder:text-ink-faint focus:outline-none"
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
                className="shrink-0 px-1 text-[11px] text-ink-faint hover:text-ink"
                title={revealed.has(i) ? 'Ocultar valor' : 'Mostrar valor'}
              >
                {revealed.has(i) ? 'ocultar' : 'ver'}
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
            className="text-ink-faint hover:text-bad"
            title="Remover variável"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          setVars([...env.variables, { key: '', value: '', secret: false, enabled: true }])
        }
        className="w-fit rounded px-2 py-1 text-xs text-ink-faint transition hover:bg-raised hover:text-ink"
      >
        + variável
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
                <span className="truncate">{env.name}</span>
                {env.isBase && <span className="ml-auto text-[10px] text-ink-faint">base</span>}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSelectedId(addEnvironment())}
            className="m-2 rounded-md border border-line px-2 py-1.5 text-xs text-ink-dim transition hover:bg-raised hover:text-ink"
          >
            + environment
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
                  className="rounded-md border border-line bg-app px-2 py-1 text-sm font-medium text-ink focus:border-brand focus:outline-none"
                />
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
                  className="ml-auto rounded px-2 py-1 text-xs text-ink-faint transition hover:bg-bad/10 hover:text-bad"
                >
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
            >
              ✕
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
