import { useState } from 'react'
import { Boxes, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { bySortOrder, useStore } from '../store'
import { useConfirm } from '../lib/confirm'

/**
 * Seletor de project no header. Project é o nível acima da collection e a
 * unidade que se compartilha inteira; trocar aqui troca a lista da sidebar.
 * Não virou um terceiro nível na sidebar de propósito — ela já tem dois.
 */
export function ProjectSelector() {
  const projects = useStore((s) => s.projects)
  const openProjectId = useStore((s) => s.openProjectId)
  const openProject = useStore((s) => s.openProject)
  const addProject = useStore((s) => s.addProject)
  const renameProject = useStore((s) => s.renameProject)
  const deleteProject = useStore((s) => s.deleteProject)
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)

  const sorted = [...projects].sort(bySortOrder)
  const open = projects.find((p) => p.id === openProjectId) ?? null
  if (!open) return null

  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-line">
      <div className="flex items-center gap-2 border-r border-line bg-panel pl-2.5">
        <Boxes aria-hidden className="size-3.5 shrink-0 text-brand" />
        {editing ? (
          <input
            autoFocus
            defaultValue={open.name}
            onBlur={(e) => {
              renameProject(open.id, e.target.value.trim() || open.name)
              setEditing(false)
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-32 rounded bg-app px-1 py-0.5 text-sm font-medium text-ink focus:outline-none"
          />
        ) : (
          <div className="relative flex items-center">
            <select
              value={open.id}
              onChange={(e) => openProject(e.target.value)}
              onDoubleClick={() => setEditing(true)}
              className="cursor-pointer appearance-none bg-transparent py-1.5 pr-6 pl-0 text-sm font-medium text-ink focus:outline-none"
              title="Project aberto — duplo clique para renomear"
            >
              {sorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-1.5 size-3 text-ink-faint"
            />
          </div>
        )}
      </div>
      <button
        onClick={() => openProject(addProject('Novo project'))}
        className="bg-panel px-2 text-ink-dim transition hover:bg-raised hover:text-ink"
        title="Novo project"
        aria-label="Novo project"
      >
        <Plus className="size-3.5" />
      </button>
      {projects.length > 1 && (
        <button
          onClick={async () => {
            const ok = await confirm({
              title: `Excluir o project "${open.name}"?`,
              message:
                'Todas as collections dele, com requests e environments, são apagadas desta máquina.',
              confirmLabel: 'Excluir project',
              danger: true,
            })
            if (ok) deleteProject(open.id)
          }}
          className="border-l border-line bg-panel px-2 text-ink-faint transition hover:bg-bad/10 hover:text-bad"
          title="Excluir project"
          aria-label="Excluir project"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}
