import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ApiRequest } from '@somnolent/core'
import { MethodChip } from './MethodChip'
import { useStore, useVisibleTabs } from '../store'

/** Where the context menu opened, in viewport coordinates. `requestId` is `null`
 *  when the click landed on the strip's empty space. */
interface MenuAt {
  x: number
  y: number
  requestId: string | null
}

/** Menu width. Must match the `w-52` class for the clamp to work. */
const MENU_WIDTH = 208

function MenuItem({
  label,
  onSelect,
  danger = false,
}: {
  label: string
  onSelect: () => void
  danger?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onSelect}
      className={`w-full px-3 py-1.5 text-left text-sm transition hover:bg-raised ${
        danger ? 'text-ink-dim hover:text-bad' : 'text-ink-dim hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}

function ContextMenu({ at, onClose }: { at: MenuAt; onClose: () => void }) {
  const closeTab = useStore((s) => s.closeTab)
  const closeOtherTabs = useStore((s) => s.closeOtherTabs)
  const closeAllTabs = useStore((s) => s.closeAllTabs)
  const tabs = useVisibleTabs()

  // Closes on anything but picking an item — click outside, Esc, scroll, blur.
  // Without this the menu hangs around.
  useEffect(() => {
    const dismiss = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // `capture` on pointerdown: the menu must vanish before the click reaches
    // whatever sits underneath.
    window.addEventListener('pointerdown', dismiss, { capture: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', dismiss, { capture: true })
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, { capture: true })
    }
  }, [onClose])

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  // The strip sits at the top, so only x needs clamping: near the right edge
  // the menu would open off screen.
  const left = Math.min(at.x, window.innerWidth - MENU_WIDTH - 8)
  // Only used inside the block where it exists; trades a `!` for a const.
  const target = at.requestId ?? ''

  return (
    <div
      role="menu"
      // The menu is not a child of the strip: `stopPropagation` keeps the
      // click-outside listener from killing it before the item click.
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left, top: at.y }}
      className="fixed z-50 w-52 overflow-hidden rounded-md border border-line bg-panel py-1 shadow-lg"
    >
      {at.requestId && (
        <>
          <MenuItem label="Close" onSelect={run(() => closeTab(target))} />
          {/* A lone tab has no "others": the item leaves instead of becoming a
              click that does nothing. */}
          {tabs.length > 1 && (
            <MenuItem label="Close others" onSelect={run(() => closeOtherTabs(target))} />
          )}
        </>
      )}
      <MenuItem label="Close all" onSelect={run(closeAllTabs)} danger />
    </div>
  )
}

function Tab({
  request,
  active,
  onContextMenu,
}: {
  request: ApiRequest
  active: boolean
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const openTab = useStore((s) => s.openTab)
  const closeTab = useStore((s) => s.closeTab)
  const mine = useRef<HTMLDivElement>(null)

  // A tab activated from outside the strip may sit out of the scrollable area.
  // The `?.` is load-bearing: jsdom has no scrollIntoView.
  useEffect(() => {
    if (active) mine.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <div
      ref={mine}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={() => openTab(request.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openTab(request.id)
        }
      }}
      onAuxClick={(e) => {
        // Middle button closes, like in any tab strip.
        if (e.button === 1) {
          e.preventDefault()
          closeTab(request.id)
        }
      }}
      onContextMenu={onContextMenu}
      title={request.name}
      className={`group relative flex h-9 max-w-56 shrink-0 cursor-pointer items-center gap-2 border-r border-line px-3 text-sm transition ${
        // The active one borrows the panel background below so the two read as
        // one; the others stay on the strip's recessed background.
        active ? 'bg-panel text-ink' : 'text-ink-dim hover:bg-raised hover:text-ink'
      }`}
    >
      {/* The top stroke marks the active tab, in the environment color that
          already paints the app's top stripe. */}
      {active && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-[var(--accent)]" />
      )}
      <MethodChip method={request.method} />
      <span className="min-w-0 flex-1 truncate">{request.name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          closeTab(request.id)
        }}
        className={`-mr-1 shrink-0 rounded p-0.5 text-ink-faint transition hover:bg-hover hover:text-ink ${
          active ? '' : 'opacity-0 group-hover:opacity-100'
        }`}
        title="Close tab"
        aria-label={`Close ${request.name}`}
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}

/** Shows only the tabs of the collection in context, and renders nothing when
 *  there is none — so the caller places the panels on its own. */
export function TabStrip({ style }: { style?: React.CSSProperties }) {
  const tabs = useVisibleTabs()
  const selectedId = useStore((s) => s.selectedRequestId)
  const [menu, setMenu] = useState<MenuAt | null>(null)

  // Last tab closed: the menu open over it has lost its subject.
  useEffect(() => {
    if (tabs.length === 0) setMenu(null)
  }, [tabs.length])

  if (tabs.length === 0) return null

  const openMenu = (requestId: string | null) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, requestId })
  }

  return (
    <div
      role="tablist"
      aria-label="Open requests"
      onContextMenu={openMenu(null)}
      style={style}
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-app
                 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((request) => (
        <Tab
          key={request.id}
          request={request}
          active={request.id === selectedId}
          onContextMenu={openMenu(request.id)}
        />
      ))}
      {menu && <ContextMenu at={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
