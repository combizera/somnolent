import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  Import,
  Layers,
  Plus,
  X,
} from 'lucide-react'
import type { ApiRequest, Collection } from '@somnolent/core'
import { bySortOrder, useStore } from '../store'
import { ImportModal } from './ImportModal'
import { MethodChip } from './MethodChip'

type DragItem = { kind: 'request' | 'collection'; id: string }
type DropSpot =
  | { kind: 'request'; id: string; edge: 'before' | 'after' }
  | { kind: 'collection'; id: string; edge: 'before' | 'after' | 'inside' }
  | { kind: 'root' }

/** Metade de cima da linha = soltar antes; metade de baixo = soltar depois. */
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
  /** Com filtro ativo a lista não reflete a ordem real, então o arraste sai de cena. */
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
        // Uma pasta não entra dentro de uma request.
        if (!drag || drag.kind === 'collection') return
        e.preventDefault()
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
          title="Duplicar request"
          aria-label="Duplicar request"
        >
          <Copy className="size-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Excluir "${request.name}"?`)) deleteRequest(request.id)
          }}
          className="rounded px-1 text-ink-faint hover:text-bad"
          title="Excluir request"
          aria-label="Excluir request"
        >
          <X className="size-3.5" />
        </button>
      </span>
    </div>
  )
}

/**
 * Precisa viver no topo do módulo: declarado dentro do Sidebar, o React trataria
 * cada render como um componente novo e remontaria a pasta no meio do arraste,
 * derrubando os handlers antes do drop chegar.
 */
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

  const here = spot?.kind === 'collection' && spot.id === col.id ? spot : null
  const isSource = drag?.kind === 'collection' && drag.id === col.id

  // Request cai dentro da pasta; outra pasta se reordena entre as irmãs.
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
      {/* o ícone diz o tipo (pasta), o chevron diz o estado (aberta/fechada) */}
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
          className="w-full cursor-text rounded bg-app px-1 text-xs text-ink focus:outline-none"
        />
      ) : (
        <span
          onDoubleClick={onStartEditing}
          className="flex-1 truncate text-xs font-semibold text-ink-dim"
          title="Arraste para reordenar · duplo clique para renomear"
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
          title="Nova request nesta pasta"
          aria-label="Nova request nesta pasta"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAddSub()
          }}
          className="px-1 text-ink-faint hover:text-ink"
          title="Nova subpasta"
          aria-label="Nova subpasta"
        >
          <FolderPlus className="size-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Excluir a pasta "${col.name}" e suas requests?`))
              deleteCollection(col.id)
          }}
          className="px-1 text-ink-faint hover:text-bad"
          title="Excluir pasta"
          aria-label="Excluir pasta"
        >
          <X className="size-3.5" />
        </button>
      </span>
    </div>
  )
}

/**
 * Linha da lista de collections (o nível de topo, estilo Insomnia): clicar
 * entra na collection em vez de expandir no mesmo aside.
 */
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
  const deleteCollection = useStore((s) => s.deleteCollection)
  const [editing, setEditing] = useState(false)

  const here = spot?.kind === 'collection' && spot.id === col.id ? spot : null
  const isSource = drag?.kind === 'collection' && drag.id === col.id

  // Request solta em cima entra na collection; outra collection se reordena.
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
          title="Clique para abrir · duplo clique para renomear"
        >
          {col.name}
        </span>
      )}
      <span className="shrink-0 font-mono text-[10px] text-ink-faint">{count}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`Excluir a collection "${col.name}" e todo o conteúdo dela?`))
            deleteCollection(col.id)
        }}
        className="shrink-0 rounded px-1 text-ink-faint opacity-0 transition group-hover:opacity-100 hover:text-bad"
        title="Excluir collection"
        aria-label="Excluir collection"
      >
        <X className="size-3.5" />
      </button>
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
  const openCollection = useStore((s) => s.openCollection)
  const renameCollection = useStore((s) => s.renameCollection)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [renamingOpen, setRenamingOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [spot, setSpot] = useState<DropSpot | null>(null)

  // Enquanto arrasta, o ponteiro do app inteiro vira "agarrando".
  useEffect(() => {
    document.body.classList.toggle('is-dragging', drag !== null)
    return () => document.body.classList.remove('is-dragging')
  }, [drag])

  // Só as collections do project aberto: dois projects não se misturam na lista.
  const sortedCollections = useMemo(
    () =>
      [...collections]
        .filter((c) => c.projectId === openProjectId)
        .sort(bySortOrder),
    [collections, openProjectId],
  )

  // A collection aberta pode não existir mais (delete remoto pelo sync, cache
  // velho do localStorage): nesse caso a lista é o fallback.
  const open = sortedCollections.find((c) => c.id === openCollectionId) ?? null
  const rootCollections = sortedCollections.filter((c) => c.parentId === null)

  /** Ids da collection e de todas as descendentes. */
  const subtreeOf = (rootId: string): Set<string> => {
    const ids = new Set<string>()
    const queue = [rootId]
    while (queue.length > 0) {
      const cur = queue.shift()!
      ids.add(cur)
      for (const c of sortedCollections) if (c.parentId === cur) queue.push(c.id)
    }
    return ids
  }

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
      // Reordenar só faz sentido entre irmãs do mesmo pai.
      if (!dragged || !anchor || dragged.parentId !== anchor.parentId) return clear()
      const others = sortedCollections.filter(
        (c) => c.parentId === dragged.parentId && c.id !== drag.id,
      )
      const idx = others.findIndex((c) => c.id === target.id)
      if (idx >= 0) moveCollection(drag.id, target.edge === 'before' ? idx : idx + 1)
      return clear()
    }

    if (target.kind === 'root') {
      // Dentro de uma collection, "raiz" é a própria collection aberta.
      const destination = open?.id ?? null
      moveRequest(drag.id, destination, siblingsOf(destination, drag.id).length)
    } else if (target.kind === 'collection') {
      // Soltar sobre a pasta manda pro fim dela.
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

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const dragProps = { enabled: dndEnabled, drag, setDrag, spot, setSpot, onDrop: handleDrop }

  const renderFolder = (col: Collection) => {
    const items = inFolder(col.id)
    const childCols = sortedCollections.filter((c) => c.parentId === col.id)
    const isCollapsed = collapsed.has(col.id) && !q
    if (q && items.length === 0 && childCols.length === 0) return null
    return (
      <div key={col.id} className="mb-1">
        <FolderHeader
          col={col}
          collapsed={isCollapsed}
          onToggle={() => toggle(col.id)}
          onAddSub={() => {
            addSubCollection(col.id, 'Nova subpasta')
            if (collapsed.has(col.id)) toggle(col.id)
          }}
          editing={editingId === col.id}
          onStartEditing={() => setEditingId(col.id)}
          onStopEditing={() => setEditingId(null)}
          {...dragProps}
        />
        {!isCollapsed && (
          <div className="mt-0.5 ml-2 flex flex-col gap-0.5 border-l border-line-soft pl-2">
            {childCols.map((child) => renderFolder(child))}
            {items.map((r) => (
              <RequestRow key={r.id} request={r} {...dragProps} />
            ))}
            {items.length === 0 && childCols.length === 0 && (
              <p className="px-2 py-1 text-xs text-ink-faint">
                {drag?.kind === 'request' ? 'solte aqui' : 'vazia'}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── nível 1: lista de collections ────────────────────────────────────────
  const renderCollectionList = () => {
    const shown = q
      ? rootCollections.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            [...subtreeOf(c.id)].some((id) => inFolder(id).length > 0),
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
            <p className="px-1 pt-1 pb-1 text-xs font-semibold text-ink-faint">
              Sem collection
            </p>
            {looseRequests.map((r) => (
              <RequestRow key={r.id} request={r} {...dragProps} />
            ))}
          </div>
        )}

        {shown.length === 0 && looseRequests.length === 0 && (
          <p className="px-2 py-3 text-xs leading-relaxed text-ink-faint">
            {q
              ? 'Nada bate com o filtro.'
              : 'Crie uma collection ou importe um export do Insomnia.'}
          </p>
        )}
      </>
    )
  }

  // ── nível 2: dentro de uma collection ────────────────────────────────────
  const renderInsideCollection = (col: Collection) => {
    const childCols = sortedCollections.filter((c) => c.parentId === col.id)
    const direct = inFolder(col.id)

    return (
      <>
        {childCols.map((child) => renderFolder(child))}

        <div className="flex flex-col gap-0.5">
          {childCols.length > 0 && direct.length > 0 && (
            <p className="px-1 pt-2 pb-1 text-xs font-semibold text-ink-faint">Sem pasta</p>
          )}
          {direct.map((r) => (
            <RequestRow key={r.id} request={r} {...dragProps} />
          ))}
        </div>

        {drag?.kind === 'request' && (
          <div
            className={`mt-2 rounded-md border border-dashed px-2 py-3 text-center text-xs transition ${
              spot?.kind === 'root'
                ? 'border-brand bg-brand/10 text-ink'
                : 'border-line text-ink-faint'
            }`}
          >
            soltar direto na collection
          </div>
        )}

        {childCols.length === 0 && direct.length === 0 && (
          <p className="px-2 py-3 text-xs leading-relaxed text-ink-faint">
            {q ? 'Nenhuma request bate com o filtro.' : 'Collection vazia — crie a primeira request.'}
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
                title="Voltar para as collections"
                aria-label="Voltar para as collections"
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
                  title={`${open.name} — duplo clique para renomear`}
                >
                  {open.name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => addRequest(open.id)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-hi"
              >
                <Plus className="size-3.5" />
                Nova request
              </button>
              <button
                onClick={() => addSubCollection(open.id, 'Nova pasta')}
                className="rounded-md border border-line px-2 py-1.5 text-xs text-ink-dim transition hover:bg-raised hover:text-ink"
                title="Nova pasta nesta collection"
                aria-label="Nova pasta nesta collection"
              >
                <FolderPlus className="size-4" />
              </button>
              <button
                onClick={() => setImporting(true)}
                className="rounded-md border border-line px-2 py-1.5 text-xs text-ink-dim transition hover:bg-raised hover:text-ink"
                title="Importar do Insomnia ou de um comando curl"
                aria-label="Importar do Insomnia ou de um comando curl"
              >
                <Import className="size-4" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => openCollection(addCollection('Nova collection'))}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-hi"
            >
              <Plus className="size-3.5" />
              Nova collection
            </button>
            <button
              onClick={() => setImporting(true)}
              className="rounded-md border border-line px-2 py-1.5 text-xs text-ink-dim transition hover:bg-raised hover:text-ink"
              title="Importar do Insomnia ou de um comando curl"
              aria-label="Importar do Insomnia ou de um comando curl"
            >
              <Import className="size-4" />
            </button>
          </div>
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={open ? 'Filtrar requests' : 'Filtrar collections'}
          className="w-full rounded-md border border-line bg-app px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
        />
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
