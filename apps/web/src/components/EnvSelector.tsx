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
    // O anel de foco vive na borda do grupo: no <select> ele desenharia só em
    // volta do texto, dentro do grupo, o que fica torto.
    <div className="flex items-stretch overflow-hidden rounded-md border border-line focus-within:border-brand">
      <div className="flex items-center gap-2 border-r border-line bg-panel pl-3">
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
            className="cursor-pointer appearance-none bg-transparent py-2 pr-7 pl-0 text-sm font-medium text-ink focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink-faint"
            title={
              collectionId
                ? 'Environment ativo — troca URL, token e todas as variáveis'
                : 'Abra uma request para escolher o environment da collection dela'
            }
          >
            {/* Sem env escolhido, valem só as variáveis do base — então o
                rótulo honesto é "Base", não uma negação. */}
            <option value="">{collectionId ? 'Base' : 'Sem collection'}</option>
            {switchable.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-2 size-3 text-ink-faint"
          />
        </div>
      </div>
      <button
        onClick={() => setManaging(true)}
        disabled={!collectionId}
        className="bg-panel px-2 text-ink-dim transition hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:text-ink-faint"
        title="Gerenciar environments e variáveis"
        aria-label="Gerenciar environments e variáveis"
      >
        <SlidersHorizontal className="size-3.5" />
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
