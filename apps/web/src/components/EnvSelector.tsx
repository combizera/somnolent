import { useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import {
  bySortOrder,
  useActiveEnv,
  useCollectionEnvs,
  useContextCollectionId,
  useStore,
} from '../store'
import { EnvManager } from './EnvManager'

export function EnvSelector() {
  // Environment pertence à collection, então o seletor mostra os da collection
  // em contexto — a da request aberta, ou a aberta na sidebar.
  const collectionId = useContextCollectionId()
  const environments = useCollectionEnvs(collectionId)
  const activeEnvByCollection = useStore((s) => s.activeEnvByCollection)
  const setActiveEnv = useStore((s) => s.setActiveEnv)
  const active = useActiveEnv()
  const [managing, setManaging] = useState(false)

  // mesma ordem que a pessoa arrastou no gerenciador
  const switchable = environments.filter((e) => !e.isBase).sort(bySortOrder)
  const activeEnvId = collectionId ? (activeEnvByCollection[collectionId] ?? '') : ''
  const collectionName = useStore(
    (s) => s.collections.find((c) => c.id === collectionId)?.name ?? '',
  )

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
            onChange={(e) => collectionId && setActiveEnv(collectionId, e.target.value || null)}
            disabled={!collectionId}
            className="cursor-pointer appearance-none bg-transparent py-1.5 pr-6 pl-0 text-xs font-medium text-ink focus:outline-none disabled:cursor-not-allowed disabled:text-ink-faint"
            title={
              collectionId
                ? 'Environment ativo — troca URL, token e todas as variáveis'
                : 'Abra uma request para escolher o environment da collection dela'
            }
          >
            <option value="">{collectionId ? 'Sem environment' : 'Sem collection'}</option>
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
        disabled={!collectionId}
        className="flex items-center gap-1.5 bg-panel px-2.5 text-xs text-ink-dim transition hover:bg-raised hover:text-ink"
        title="Gerenciar environments e variáveis"
      >
        <SlidersHorizontal className="size-3.5" />
        Gerenciar
      </button>
      {managing && collectionId && (
        <EnvManager
          collectionId={collectionId}
          collectionName={collectionName}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  )
}
