import { useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
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
        {/* o chevron é um ícone sobreposto, não background-image: assim segue o tema */}
        <div className="relative flex items-center">
          <select
            value={activeEnvId ?? ''}
            onChange={(e) => setActiveEnv(e.target.value || null)}
            className="cursor-pointer appearance-none bg-transparent py-1.5 pr-6 pl-0 text-xs font-medium text-ink focus:outline-none"
            title="Environment ativo — troca URL, token e todas as variáveis"
          >
            <option value="">Sem environment</option>
            {switchable.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-1.5 size-3 text-ink-faint"
          />
        </div>
      </div>
      <button
        onClick={() => setManaging(true)}
        className="flex items-center gap-1.5 bg-panel px-2.5 text-xs text-ink-dim transition hover:bg-raised hover:text-ink"
        title="Gerenciar environments e variáveis"
      >
        <SlidersHorizontal className="size-3.5" />
        Gerenciar
      </button>
      {managing && <EnvManager onClose={() => setManaging(false)} />}
    </div>
  )
}
