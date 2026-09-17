import { useState } from 'react'
import { Boxes, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { bySortOrder, useStore } from '../store'
import { useConfirm } from '../lib/confirm'
import { headerGroup, headerGroupBody, headerSelect } from '../lib/ui'

/** A project is the level above the collection and the unit that gets shared
 *  whole; it is not a third sidebar level on purpose — it already has two. */
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
    <div className={headerGroup}>
      <div className={headerGroupBody}>
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
            className="w-32 rounded bg-app px-1 py-0.5 text-sm font-medium text-ink focus:outline-none focus-visible:outline-none"
          />
        ) : (
          <div className="relative flex items-center self-stretch">
            <select
              value={open.id}
              onChange={(e) => openProject(e.target.value)}
              onDoubleClick={() => setEditing(true)}
              className={headerSelect}
              title="Open project — double click to rename"
            >
              {sorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-2 size-3 text-ink-faint"
            />
          </div>
        )}
      </div>
      <button
        onClick={() => openProject(addProject('New project'))}
        className="bg-panel px-2 text-ink-dim transition hover:bg-raised hover:text-ink"
        title="New project"
        aria-label="New project"
      >
        <Plus className="size-3.5" />
      </button>
      {projects.length > 1 && (
        <button
          onClick={async () => {
            const ok = await confirm({
              title: `Delete the project "${open.name}"?`,
              message:
                'Every collection of it, with requests and environments, is erased from this machine.',
              confirmLabel: 'Delete project',
              danger: true,
            })
            if (ok) deleteProject(open.id)
          }}
          className="border-l border-line bg-panel px-2 text-ink-faint transition hover:bg-bad/10 hover:text-bad"
          title="Delete project"
          aria-label="Delete project"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}
