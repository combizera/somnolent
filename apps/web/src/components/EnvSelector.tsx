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
import { headerGroup, headerGroupBody, headerSelect } from '../lib/ui'

export function EnvSelector() {
  // An environment belongs to a collection, so the picker shows the ones of the
  // collection in context — the open request's, or the one open in the sidebar.
  const collectionId = useContextCollectionId()
  const environments = useCollectionEnvs(collectionId)
  const activeEnvByCollection = useStore((s) => s.activeEnvByCollection)
  const setActiveEnv = useStore((s) => s.setActiveEnv)
  const active = useActiveEnv()
  const [managing, setManaging] = useState(false)

  // same order the person dragged in the manager
  const switchable = environments.filter((e) => !e.isBase).sort(bySortOrder)
  const activeEnvId = collectionId ? (activeEnvByCollection[collectionId] ?? '') : ''
  const collectionName = useStore(
    (s) => s.collections.find((c) => c.id === collectionId)?.name ?? '',
  )

  return (
    // The focus ring lives on the group border: on the <select> it would draw
    // around the text only, inside the group, which reads crooked.
    <div className={headerGroup}>
      <div className={headerGroupBody}>
        <span
          className="size-2 shrink-0 rounded-full transition-colors"
          style={{ background: active?.color ?? 'var(--color-ink-faint)' }}
        />
        {/* the chevron is an overlaid icon, not a background-image, so it follows the theme */}
        <div className="relative flex items-center self-stretch">
          <select
            value={activeEnvId ?? ''}
            onChange={(e) => collectionId && setActiveEnv(collectionId, e.target.value || null)}
            disabled={!collectionId}
            className={`${headerSelect} disabled:cursor-not-allowed disabled:text-ink-faint`}
            title={
              collectionId
                ? 'Active environment — swaps URL, token and every variable'
                : 'Open a request to pick its collection environment'
            }
          >
            {/* With no env chosen only the base variables apply, so the honest
                label is "Base", not a negation. */}
            <option value="">{collectionId ? 'Base' : 'No collection'}</option>
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
        title="Manage environments and variables"
        aria-label="Manage environments and variables"
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
