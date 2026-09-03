import { FolderPlus, Import, Layers, Plus, Search } from 'lucide-react'
import { useStore } from '../store'
import { Logo } from './Logo'

/** Atalho da tela vazia: ícone, título, uma linha de explicação. */
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

/**
 * Tela do meio quando não há request aberta. Tem duas caras, porque as saídas
 * são diferentes: sem collection escolhida, o caminho é criar ou importar uma;
 * dentro de uma collection, é criar a primeira request.
 */
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
      aria-label="Nenhuma request aberta"
      className="grid place-items-center overflow-y-auto bg-panel p-8"
    >
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="size-10 opacity-90" />
          {open ? (
            <>
              <h2 className="text-base font-semibold text-ink">{open.name}</h2>
              <p className="max-w-xs text-sm leading-relaxed text-ink-dim">
                Escolha uma request na lateral, ou comece uma nova nesta collection.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-ink">
                {doProject.length > 0 ? 'Escolha uma collection' : 'Comece uma collection'}
              </h2>
              <p className="max-w-xs text-sm leading-relaxed text-ink-dim">
                {doProject.length > 0
                  ? `${doProject.length} collection(s) em ${project?.name ?? 'seu project'}. Abra uma na lateral pra ver as requests.`
                  : `O project ${project?.name ?? ''} ainda está vazio. Crie uma collection ou traga a sua do Insomnia.`}
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {open ? (
            <Action
              icon={<Plus className="size-4" />}
              title="Nova request"
              hint={`Entra direto em ${open.name}.`}
              onClick={() => selectRequest(addRequest(open.id))}
            />
          ) : (
            <Action
              icon={<FolderPlus className="size-4" />}
              title="Nova collection"
              hint="Um grupo de requests — normalmente, uma API."
              onClick={() => openCollection(addCollection('Nova collection'))}
            />
          )}

          {!open && doProject.length > 0 && (
            <Action
              icon={<Layers className="size-4" />}
              title={`Abrir ${doProject[0]!.name}`}
              hint="A primeira da lista, pra você não precisar mirar."
              onClick={() => openCollection(doProject[0]!.id)}
            />
          )}

          <Action
            icon={<Search className="size-4" />}
            title="Buscar request"
            hint="Por nome, URL ou método, em todo o project."
            kbd="Ctrl K"
            onClick={buscar}
          />

          {!open && (
            <Action
              icon={<Import className="size-4" />}
              title="Importar do Insomnia"
              hint="Cole um export v5 ou v4, ou um comando curl."
              onClick={() =>
                document
                  .querySelector<HTMLButtonElement>('[aria-label^="Importar"]')
                  ?.click()
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}
