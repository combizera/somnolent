import { FolderPlus, Import, Layers, Plus, Search } from 'lucide-react'
import { useStore } from '../store'
import { Logo } from './Logo'

/** Empty-screen shortcut: icon, title, one line of explanation. */
function Action({
  icon,
  title,
  hint,
  onClick,
  kbd,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  onClick: () => void
  kbd?: string
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-3 rounded-lg border border-line bg-app px-4 py-3 text-left transition hover:border-brand/50 hover:bg-raised"
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-hi transition group-hover:bg-brand group-hover:text-white">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          {title}
          {kbd && (
            <kbd className="rounded border border-line bg-panel px-1.5 py-px font-mono text-[10px] text-ink-faint">
              {kbd}
            </kbd>
          )}
        </span>
        <span className="text-sm leading-relaxed text-ink-faint">{hint}</span>
      </span>
    </button>
  )
}

/** Two faces because the ways out differ: with no collection chosen, create or
 *  import one; inside a collection, create the first request. */
export function EmptyState() {
  const openCollectionId = useStore((s) => s.openCollectionId)
  const collections = useStore((s) => s.collections)
  const openProjectId = useStore((s) => s.openProjectId)
  const projects = useStore((s) => s.projects)
  const addCollection = useStore((s) => s.addCollection)
  const openCollection = useStore((s) => s.openCollection)
  const addRequest = useStore((s) => s.addRequest)
  const selectRequest = useStore((s) => s.selectRequest)

  const open = collections.find((c) => c.id === openCollectionId) ?? null
  const project = projects.find((p) => p.id === openProjectId) ?? null
  const doProject = collections.filter(
    (c) => c.parentId === null && c.projectId === openProjectId,
  )

  const buscar = () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    )

  return (
    <div
      role="region"
      aria-label="No request open"
      className="grid place-items-center overflow-y-auto bg-panel p-8"
    >
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="size-10 opacity-90" />
          {open ? (
            <>
              <h2 className="text-base font-semibold text-ink">{open.name}</h2>
              <p className="max-w-xs text-sm leading-relaxed text-ink-dim">
                Pick a request on the side, or start a new one in this collection.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-ink">
                {doProject.length > 0 ? 'Pick a collection' : 'Start a collection'}
              </h2>
              <p className="max-w-xs text-sm leading-relaxed text-ink-dim">
                {doProject.length > 0
                  ? `${doProject.length} collection(s) in ${project?.name ?? 'your project'}. Open one on the side to see its requests.`
                  : `Project ${project?.name ?? ''} is still empty. Create a collection or bring yours from Insomnia.`}
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {open ? (
            <Action
              icon={<Plus className="size-4" />}
              title="New request"
              hint={`Lands straight in ${open.name}.`}
              onClick={() => selectRequest(addRequest(open.id))}
            />
          ) : (
            <Action
              icon={<FolderPlus className="size-4" />}
              title="New collection"
              hint="A group of requests — usually one API."
              onClick={() => openCollection(addCollection('Nova collection'))}
            />
          )}

          {!open && doProject.length > 0 && (
            <Action
              icon={<Layers className="size-4" />}
              title={`Open ${doProject[0]!.name}`}
              hint="The first on the list, so you do not have to aim."
              onClick={() => openCollection(doProject[0]!.id)}
            />
          )}

          <Action
            icon={<Search className="size-4" />}
            title="Search request"
            hint="By name, URL or method, across the whole project."
            kbd="Ctrl K"
            onClick={buscar}
          />

          {!open && (
            <Action
              icon={<Import className="size-4" />}
              title="Import from Insomnia"
              hint="Paste a v5 or v4 export, or a curl command."
              onClick={() =>
                document
                  .querySelector<HTMLButtonElement>('[aria-label^="Import"]')
                  ?.click()
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}
