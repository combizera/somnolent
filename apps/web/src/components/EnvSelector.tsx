import { useState } from 'react'
import { useActiveEnv, useStore } from '../store'
import { EnvManager } from './EnvManager'

export function EnvSelector() {
  const environments = useStore((s) => s.environments)
  const activeEnvId = useStore((s) => s.activeEnvId)
  const setActiveEnv = useStore((s) => s.setActiveEnv)
  const active = useActiveEnv()
  const [managing, setManaging] = useState(false)

  const switchable = environments.filter((e) => !e.isBase)

  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-line">
      <div className="flex items-center gap-2 border-r border-line bg-panel pl-2.5">
        <span
          className="size-2 shrink-0 rounded-full transition-colors"
          style={{ background: active?.color ?? 'var(--color-ink-faint)' }}
        />
        <select
          value={activeEnvId ?? ''}
          onChange={(e) => setActiveEnv(e.target.value || null)}
          className="cursor-pointer appearance-none bg-transparent py-1.5 pr-6 pl-0 text-xs font-medium text-ink focus:outline-none"
          title="Environment ativo — troca URL, token e todas as variáveis"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath fill='%239a9aad' d='M3 4.5L6 8l3-3.5z'/%3E%3C/svg%3E\")",
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 6px center',
            backgroundSize: '12px',
          }}
        >
          <option value="">Sem environment</option>
          {switchable.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={() => setManaging(true)}
        className="bg-panel px-2.5 text-xs text-ink-dim transition hover:bg-raised hover:text-ink"
        title="Gerenciar environments e variáveis"
      >
        Gerenciar
      </button>
      {managing && <EnvManager onClose={() => setManaging(false)} />}
    </div>
  )
}
