import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  Import,
  Layers,
  Plus,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import { subtreeIds } from '@somnolent/core'
import type { ApiRequest, Collection } from '@somnolent/core'
import { bySortOrder, useStore } from '../store'
import { useConfirm } from '../lib/confirm'
import { useSession } from '../sessionStore'
import { ImportModal } from './ImportModal'
import { MethodChip } from './MethodChip'

type DragItem = { kind: 'request' | 'collection'; id: string }
type DropSpot =
  | { kind: 'request'; id: string; edge: 'before' | 'after' }
  | { kind: 'collection'; id: string; edge: 'before' | 'after' | 'inside' }
  | { kind: 'root' }

/** Top half of the row = drop before; bottom half = drop after. */
function edgeOf(e: React.DragEvent): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function sameSpot(a: DropSpot | null, b: DropSpot): boolean {
  if (!a || a.kind !== b.kind) return false
  if (a.kind === 'root' || b.kind === 'root') return true
  return a.id === (b as { id: string }).id && a.edge === (b as { edge: string }).edge
}

const LINE = 'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-brand'

interface DragProps {
  /** With a filter on, the list is not the real order, so dragging steps aside. */
  enabled: boolean
  drag: DragItem | null
  setDrag: (d: DragItem | null) => void
  spot: DropSpot | null
  setSpot: (s: DropSpot | null) => void
  onDrop: (spot: DropSpot) => void
}

function RequestRow({
  request,
  enabled,
  drag,
  setDrag,
  spot,
  setSpot,
  onDrop,
}: DragProps & { request: ApiRequest }) {
  const selectedId = useStore((s) => s.selectedRequestId)
  const selectRequest = useStore((s) => s.selectRequest)
  const deleteRequest = useStore((s) => s.deleteRequest)
  const duplicateRequest = useStore((s) => s.duplicateRequest)
  const confirm = useConfirm()
  const selected = selectedId === request.id
  const isSource = drag?.kind === 'request' && drag.id === request.id
  const here = spot?.kind === 'request' && spot.id === request.id ? spot : null

  return (
    <div
      draggable={enabled}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', request.id)
        setDrag({ kind: 'request', id: request.id })
      }}
      onDragEnd={() => {
        setDrag(null)
        setSpot(null)
      }}
      onDragOver={(e) => {
        // A folder does not go inside a request.
        if (!drag || drag.kind === 'collection') return
        e.preventDefault()
        // Without this the <nav> gets the same event and overwrites the target
        // with "root" — that is what made the hint flicker mid-drag.
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        const next: DropSpot = { kind: 'request', id: request.id, edge: edgeOf(e) }
        if (!sameSpot(spot, next)) setSpot(next)
      }}
      onDrop={(e) => {
        if (!drag || drag.kind === 'collection') return
        e.preventDefault()
        e.stopPropagation()
        onDrop({ kind: 'request', id: request.id, edge: edgeOf(e) })
      }}
      onClick={() => selectRequest(request.id)}
      className={`group relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-1 pl-2 text-sm ${
        selected ? 'bg-hover text-ink' : 'text-ink-dim hover:bg-raised'
      } ${isSource ? 'drag-source' : ''}`}
    >
      {here?.edge === 'before' && <span className={`${LINE} -top-px`} />}
      {here?.edge === 'after' && <span className={`${LINE} -bottom-px`} />}
      {selected && (
        <span className="pointer-events-none absolute top-1.5 bottom-1.5 -left-2 w-[2px] rounded-full bg-brand" />
      )}
      <MethodChip method={request.method} />
      <span className="min-w-0 flex-1 truncate">{request.name}</span>
      <span className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation()
            duplicateRequest(request.id)
          }}
          className="rounded px-1 text-ink-faint hover:text-ink"
          title="Duplicate request"
          aria-label="Duplicate request"
        >
          <Copy className="size-3.5" />
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation()
            const ok = await confirm({
              title: `Delete the request "${request.name}"?`,
              message: 'Its response history goes with it. This cannot be undone.',
              confirmLabel: 'Delete request',
              danger: true,
            })
            if (ok) deleteRequest(request.id)
          }}
          className="rounded px-1 text-ink-faint hover:text-bad"
          title="Delete request"
          aria-label="Delete request"
        >
          <X className="size-3.5" />
        </button>
      </span>
    </div>
  )
}

/** Has to live at module top: declared inside Sidebar, React would treat every
 *  render as a new component and remount the folder mid-drag. */
function FolderHeader({
  col,
  collapsed,
  onToggle,
  onAddSub,
  editing,
  onStartEditing,
  onStopEditing,
  enabled,
  drag,
  setDrag,
  spot,
  setSpot,
  onDrop,
}: DragProps & {
  col: Collection
  collapsed: boolean
  onToggle: () => void
  onAddSub: () => void
  editing: boolean
  onStartEditing: () => void
  onStopEditing: () => void
}) {
  const renameCollection = useStore((s) => s.renameCollection)
  const deleteCollection = useStore((s) => s.deleteCollection)
  const addRequest = useStore((s) => s.addRequest)
  const confirm = useConfirm()

  const here = spot?.kind === 'collection' && spot.id === col.id ? spot : null
  const isSource = drag?.kind === 'collection' && drag.id === col.id

  // A request drops inside the folder; another folder reorders among siblings.
  const spotFor = (e: React.DragEvent): DropSpot =>
    drag?.kind === 'request'
      ? { kind: 'collection', id: col.id, edge: 'inside' }
      : { kind: 'collection', id: col.id, edge: edgeOf(e) }

  return (
    <div
      draggable={enabled && !editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', col.id)
        setDrag({ kind: 'collection', id: col.id })
      }}
      onDragEnd={() => {
        setDrag(null)
        setSpot(null)
      }}
      onDragOver={(e) => {
        if (!drag) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        const next = spotFor(e)
        if (!sameSpot(spot, next)) setSpot(next)
      }}
      onDrop={(e) => {
        if (!drag) return
        e.preventDefault()
        e.stopPropagation()
        onDrop(spotFor(e))
      }}
      onClick={onToggle}
      className={`group relative flex cursor-pointer items-center gap-1 rounded-md px-1 py-1 hover:bg-raised ${
        isSource ? 'drag-source' : ''
      } ${here?.edge === 'inside' ? 'bg-brand/15 ring-1 ring-brand/60' : ''}`}
    >
      {here?.edge === 'before' && <span className={`${LINE} -top-px`} />}
      {here?.edge === 'after' && <span className={`${LINE} -bottom-px`} />}
      <ChevronDown
        aria-hidden
        className="size-4 shrink-0 text-ink-faint transition-transform"
        style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }}
      />
      {/* the icon says the type (folder), the chevron says the state */}
      {collapsed ? (
        <Folder aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
      ) : (
        <FolderOpen aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
      )}
      {editing ? (
        <input
          autoFocus
          defaultValue={col.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            renameCollection(col.id, e.target.value.trim() || col.name)
            onStopEditing()
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="w-full cursor-text rounded bg-app px-1 text-sm text-ink focus:outline-none"
        />
      ) : (
        <span
          onDoubleClick={onStartEditing}
          className="flex-1 truncate text-sm font-semibold text-ink-dim"
          title="Drag to reorder · double click to rename"
        >
          {col.name}
        </span>
      )}
      <span className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation()
            addRequest(col.id)
          }}
          className="px-1 text-ink-faint hover:text-ink"
          title="New request in this folder"
          aria-label="New request in this folder"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAddSub()
          }}
          className="px-1 text-ink-faint hover:text-ink"
          title="New subfolder"
          aria-label="New subfolder"
        >
          <FolderPlus className="size-3.5" />
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation()
            const ok = await confirm({
              title: `Delete the folder "${col.name}"?`,
              message: 'The requests and subfolders inside it go with it.',
              confirmLabel: 'Delete folder',
              danger: true,
            })
            if (ok) deleteCollection(col.id)
          }}
          className="px-1 text-ink-faint hover:text-bad"
          title="Delete folder"
          aria-label="Delete folder"
        >
          <X className="size-3.5" />
        </button>
      </span>
    </div>
  )
}

/** Row of the collection list (the Insomnia-style top level): clicking enters
 *  the collection instead of expanding it in place. */
function CollectionRow({
  col,
  count,
  enabled,
  drag,
  setDrag,
  spot,
  setSpot,
  onDrop,
}: DragProps & { col: Collection; count: number }) {
  const openCollection = useStore((s) => s.openCollection)
  const renameCollection = useStore((s) => s.renameCollection)
  const [editing, setEditing] = useState(false)

  const here = spot?.kind === 'collection' && spot.id === col.id ? spot : null
  const isSource = drag?.kind === 'collection' && drag.id === col.id

  // A request dropped on top enters the collection; another one reorders.
  const spotFor = (e: React.DragEvent): DropSpot =>
    drag?.kind === 'request'
      ? { kind: 'collection', id: col.id, edge: 'inside' }
      : { kind: 'collection', id: col.id, edge: edgeOf(e) }

  return (
    <div
      draggable={enabled && !editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', col.id)
        setDrag({ kind: 'collection', id: col.id })
      }}
      onDragEnd={() => {
        setDrag(null)
        setSpot(null)
      }}
      onDragOver={(e) => {
        if (!drag) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        const next = spotFor(e)
        if (!sameSpot(spot, next)) setSpot(next)
      }}
      onDrop={(e) => {
        if (!drag) return
        e.preventDefault()
        e.stopPropagation()
        onDrop(spotFor(e))
      }}
      onClick={() => !editing && openCollection(col.id)}
      className={`group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-ink-dim transition hover:bg-raised hover:text-ink ${
        here?.edge === 'inside' ? 'bg-brand/10 ring-1 ring-brand' : ''
      } ${isSource ? 'drag-source' : ''}`}
    >
      {here?.edge === 'before' && <span className={`${LINE} -top-px`} />}
      {here?.edge === 'after' && <span className={`${LINE} -bottom-px`} />}
      <Layers aria-hidden className="size-4 shrink-0 text-brand" />
      {editing ? (
        <input
          autoFocus
          defaultValue={col.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            renameCollection(col.id, e.target.value.trim() || col.name)
            setEditing(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="min-w-0 flex-1 cursor-text rounded bg-app px-1 text-sm text-ink focus:outline-none"
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate font-medium"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          title="Click to open · double click to rename"
        >
          {col.name}
        </span>
      )}
      <span className="shrink-0 font-mono text-[10px] text-ink-faint">{count}</span>
      {/* Deleting a collection does not live here: too destructive for a target
          that shares hover with the click that opens it. */}
      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint" />
    </div>
  )
}

export function Sidebar() {
  const collections = useStore((s) => s.collections)
  const requests = useStore((s) => s.requests)
  const addCollection = useStore((s) => s.addCollection)
  const addSubCollection = useStore((s) => s.addSubCollection)
  const addRequest = useStore((s) => s.addRequest)
  const moveRequest = useStore((s) => s.moveRequest)
  const moveCollection = useStore((s) => s.moveCollection)
  const openCollectionId = useStore((s) => s.openCollectionId)
  const openProjectId = useStore((s) => s.openProjectId)
  // Persisted: reloading the page gives the folders back as you left them.
  const expandedFolders = useStore((s) => s.expandedFolders)
  const toggleFolder = useStore((s) => s.toggleFolder)
  const expandFolders = useStore((s) => s.expandFolders)
  const collapseFolders = useStore((s) => s.collapseFolders)
  const openCollection = useStore((s) => s.openCollection)
  const renameCollection = useStore((s) => s.renameCollection)
  const deleteCollection = useStore((s) => s.deleteCollection)
  const openShare = useSession((s) => s.openShare)
  const confirm = useConfirm()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [renamingOpen, setRenamingOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [filter, setFilter] = useState('')
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [spot, setSpot] = useState<DropSpot | null>(null)

  // While dragging, the whole app's pointer becomes "grabbing".
  useEffect(() => {
    document.body.classList.toggle('is-dragging', drag !== null)
    return () => document.body.classList.remove('is-dragging')
  }, [drag])

  // Only the open project's collections: two projects never mix in the list.
  const sortedCollections = useMemo(
    () =>
      [...collections]
        .filter((c) => c.projectId === openProjectId)
        .sort(bySortOrder),
    [collections, openProjectId],
  )

  // The open collection may be gone (remote delete, stale localStorage): the
  // list is the fallback in that case.
  const open = sortedCollections.find((c) => c.id === openCollectionId) ?? null
  const rootCollections = sortedCollections.filter((c) => c.parentId === null)


  const countsByCollection = useMemo(() => {
    const parentOf = new Map(collections.map((c) => [c.id, c.parentId]))
    const counts = new Map<string, number>()
    for (const r of requests) {
      let cursor = r.collectionId
      while (cursor) {
        counts.set(cursor, (counts.get(cursor) ?? 0) + 1)
        cursor = parentOf.get(cursor) ?? null
      }
    }
    return counts
  }, [collections, requests])

  const q = filter.toLowerCase().trim()

  const visible = useMemo(() => {
    const mine = requests.filter((r) => r.projectId === openProjectId)
    const list = q
      ? mine.filter(
          (r) => r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q),
        )
      : mine
    return [...list].sort(bySortOrder)
  }, [q, requests, openProjectId])

  const inFolder = (id: string | null) => visible.filter((r) => r.collectionId === id)
  const looseRequests = inFolder(null)
  const dndEnabled = !q

  const siblingsOf = (collectionId: string | null, excludeId: string) =>
    requests
      .filter((r) => r.collectionId === collectionId && r.id !== excludeId)
      .sort(bySortOrder)

  const handleDrop = (target: DropSpot) => {
    if (!drag) return
    const clear = () => {
      setDrag(null)
      setSpot(null)
    }

    if (drag.kind === 'collection') {
      if (target.kind !== 'collection' || target.id === drag.id) return clear()
      const dragged = collections.find((c) => c.id === drag.id)
      const anchor = collections.find((c) => c.id === target.id)
      // Reordering only makes sense among siblings of the same parent.
      if (!dragged || !anchor || dragged.parentId !== anchor.parentId) return clear()
      const others = sortedCollections.filter(
        (c) => c.parentId === dragged.parentId && c.id !== drag.id,
      )
      const idx = others.findIndex((c) => c.id === target.id)
      if (idx >= 0) moveCollection(drag.id, target.edge === 'before' ? idx : idx + 1)
      return clear()
    }

    if (target.kind === 'root') {
      // Inside a collection, "root" is the open collection itself.
      const destination = open?.id ?? null
      moveRequest(drag.id, destination, siblingsOf(destination, drag.id).length)
    } else if (target.kind === 'collection') {
      // Dropping on the folder sends it to the end of it.
      moveRequest(drag.id, target.id, siblingsOf(target.id, drag.id).length)
    } else {
      const anchor = requests.find((r) => r.id === target.id)
      if (!anchor || anchor.id === drag.id) return clear()
      const siblings = siblingsOf(anchor.collectionId, drag.id)
      const idx = siblings.findIndex((r) => r.id === anchor.id)
      moveRequest(drag.id, anchor.collectionId, target.edge === 'before' ? idx : idx + 1)
    }
    clear()
  }


  const dragProps = { enabled: dndEnabled, drag, setDrag, spot, setSpot, onDrop: handleDrop }

  // Collapsible folders: everything under the open collection, minus itself.
  const foldersInside = open
    ? [...subtreeIds(sortedCollections, open.id)].filter((id) => id !== open.id)
    : []
  const allCollapsed =
    foldersInside.length > 0 && !foldersInside.some((id) => expandedFolders.includes(id))
  const toggleAll = () =>
    allCollapsed ? expandFolders(foldersInside) : collapseFolders(foldersInside)

  const renderFolder = (col: Collection) => {
    const items = inFolder(col.id)
    const childCols = sortedCollections.filter((c) => c.parentId === col.id)
    // Collapsed by default: only what is in the open list expands, or everything
    // while a filter is on — otherwise the hit would stay hidden.
    const isCollapsed = !expandedFolders.includes(col.id) && !q
    if (q && items.length === 0 && childCols.length === 0) return null
    return (
      <div key={col.id} className="mb-1">
        <FolderHeader
          col={col}
          collapsed={isCollapsed}
          onToggle={() => toggleFolder(col.id)}
          onAddSub={() => {
            addSubCollection(col.id, 'New subfolder')
            // creating a subfolder inside a closed one would hide what just appeared
            expandFolders([col.id])
          }}
          editing={editingId === col.id}
          onStartEditing={() => setEditingId(col.id)}
          onStopEditing={() => setEditingId(null)}
          {...dragProps}
        />
        {!isCollapsed && (
          <div
            className="mt-0.5 ml-2 flex flex-col gap-0.5 border-l border-line-soft pl-2"
            // The folder body takes the drop too: the gap between rows fell to
            // the <nav> and the request ended up outside any folder.
            onDragOver={(e) => {
              if (!drag || drag.kind !== 'request') return
              e.preventDefault()
              e.stopPropagation()
              const next: DropSpot = { kind: 'collection', id: col.id, edge: 'inside' }
              if (!sameSpot(spot, next)) setSpot(next)
            }}
            onDrop={(e) => {
              if (!drag || drag.kind !== 'request') return
              e.preventDefault()
              e.stopPropagation()
              handleDrop({ kind: 'collection', id: col.id, edge: 'inside' })
            }}
          >
            {childCols.map((child) => renderFolder(child))}
            {items.map((r) => (
              <RequestRow key={r.id} request={r} {...dragProps} />
            ))}
            {items.length === 0 && childCols.length === 0 && (
              <p className="px-2 py-1 text-sm text-ink-faint">
                {drag?.kind === 'request' ? 'Drop here' : 'Empty'}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── level 1: the collection list ─────────────────────────────────────────
  const renderCollectionList = () => {
    const shown = q
      ? rootCollections.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            [...subtreeIds(sortedCollections, c.id)].some((id) => inFolder(id).length > 0),
        )
      : rootCollections

    return (
      <>
        {shown.map((col) => (
          <CollectionRow
            key={col.id}
            col={col}
            count={countsByCollection.get(col.id) ?? 0}
            {...dragProps}
          />
        ))}

        {looseRequests.length > 0 && (
          <div className="mt-2 flex flex-col gap-0.5">
            <p className="px-1 pt-1 pb-1 text-sm font-semibold text-ink-faint">
              No collection
            </p>
            {looseRequests.map((r) => (
              <RequestRow key={r.id} request={r} {...dragProps} />
            ))}
          </div>
        )}

        {shown.length === 0 && looseRequests.length === 0 && (
          <p className="px-2 py-3 text-sm leading-relaxed text-ink-faint">
            {q
              ? 'Nothing matches the filter.'
              : 'Create a collection or import an Insomnia export.'}
          </p>
        )}
      </>
    )
  }

  // ── level 2: inside a collection ─────────────────────────────────────────
  const renderInsideCollection = (col: Collection) => {
    const childCols = sortedCollections.filter((c) => c.parentId === col.id)
    const direct = inFolder(col.id)

    return (
      <>
        {childCols.map((child) => renderFolder(child))}

        <div className="flex flex-col gap-0.5">
          {childCols.length > 0 && direct.length > 0 && (
            <p className="px-1 pt-2 pb-1 text-sm font-semibold text-ink-faint">No folder</p>
          )}
          {direct.map((r) => (
            <RequestRow key={r.id} request={r} {...dragProps} />
          ))}
        </div>

        {drag?.kind === 'request' && (
          <div
            className={`mt-2 rounded-md border border-dashed px-2 py-3 text-center text-sm transition ${
              spot?.kind === 'root'
                ? 'border-brand bg-brand/10 text-ink'
                : 'border-line text-ink-faint'
            }`}
          >
            Drop straight into the collection
          </div>
        )}

        {childCols.length === 0 && direct.length === 0 && (
          <p className="px-2 py-3 text-sm leading-relaxed text-ink-faint">
            {q ? 'No request matches the filter.' : 'Empty collection — create the first request.'}
          </p>
        )}
      </>
    )
  }

  return (
    <aside className="flex h-full flex-col overflow-hidden border-r border-line bg-panel">
      <div className="flex flex-col gap-2 p-2">
        {open ? (
          <>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  openCollection(null)
                  setFilter('')
                }}
                className="rounded-md border border-line px-1.5 py-1.5 text-ink-dim transition hover:bg-raised hover:text-ink"
                title="Back to collections"
                aria-label="Back to collections"
              >
                <ChevronLeft className="size-4" />
              </button>
              <Layers aria-hidden className="size-4 shrink-0 text-brand" />
              {renamingOpen ? (
                <input
                  autoFocus
                  defaultValue={open.name}
                  onBlur={(e) => {
                    renameCollection(open.id, e.target.value.trim() || open.name)
                    setRenamingOpen(false)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="min-w-0 flex-1 rounded bg-app px-1 py-0.5 text-sm text-ink focus:outline-none"
                />
              ) : (
                <span
                  onDoubleClick={() => setRenamingOpen(true)}
                  className="min-w-0 flex-1 truncate text-sm font-semibold text-ink"
                  title={`${open.name} — double click to rename`}
                >
                  {open.name}
                </span>
              )}
              <button
                onClick={() => openShare(open.id)}
                className="shrink-0 rounded px-1.5 py-1 text-ink-faint transition hover:bg-raised hover:text-ink"
                title="Share this collection only"
                aria-label="Share this collection only"
              >
                <Share2 className="size-3.5" />
              </button>
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete the collection "${open.name}"?`,
                    message: `${countsByCollection.get(open.id) ?? 0} request(s), its folders and its environments are erased. This cannot be undone.`,
                    confirmLabel: 'Delete collection',
                    danger: true,
                  })
                  if (ok) deleteCollection(open.id)
                }}
                className="shrink-0 rounded px-1.5 py-1 text-ink-faint transition hover:bg-bad/10 hover:text-bad"
                title="Delete this collection"
                aria-label="Delete this collection"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => addRequest(open.id)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-hi"
              >
                <Plus className="size-3.5" />
                New request
              </button>
              <button
                onClick={() => addSubCollection(open.id, 'New folder')}
                className="rounded-md border border-line px-2 py-1.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
                title="New folder in this collection"
                aria-label="New folder in this collection"
              >
                <FolderPlus className="size-4" />
              </button>
              <button
                onClick={() => setImporting(true)}
                className="rounded-md border border-line px-2 py-1.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
                title="Import from Insomnia or from a curl command"
                aria-label="Import from Insomnia or from a curl command"
              >
                <Import className="size-4" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => openCollection(addCollection('New collection'))}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-hi"
            >
              <Plus className="size-3.5" />
              New collection
            </button>
            <button
              onClick={() => setImporting(true)}
              className="rounded-md border border-line px-2 py-1.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
              title="Import from Insomnia or from a curl command"
              aria-label="Import from Insomnia or from a curl command"
            >
              <Import className="size-4" />
            </button>
          </div>
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={open ? 'Filter requests' : 'Filter collections'}
          className="w-full rounded-md border border-line bg-app px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
        />
        {foldersInside.length > 0 && (
          <button
            onClick={toggleAll}
            className="flex w-fit items-center gap-1.5 rounded px-1 py-0.5 text-sm text-ink-faint transition hover:text-ink"
            title={allCollapsed ? 'Expand all folders' : 'Collapse all folders'}
          >
            {allCollapsed ? (
              <ChevronsUpDown className="size-3.5" />
            ) : (
              <ChevronsDownUp className="size-3.5" />
            )}
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>

      {importing && <ImportModal onClose={() => setImporting(false)} />}

      <nav
        className="flex-1 overflow-y-auto px-2 pb-3"
        onDragOver={(e) => {
          if (!drag || drag.kind !== 'request') return
          e.preventDefault()
          if (!sameSpot(spot, { kind: 'root' })) setSpot({ kind: 'root' })
        }}
        onDrop={(e) => {
          if (!drag || drag.kind !== 'request') return
          e.preventDefault()
          handleDrop({ kind: 'root' })
        }}
      >
        {open ? renderInsideCollection(open) : renderCollectionList()}
      </nav>
    </aside>
  )
}
