import { useEffect, useRef } from 'react'

interface Props {
  /** Screen-reader label, e.g. "Sidebar width". */
  label: string
  /** Gets the pointer's clientX; the caller turns it into a width. */
  onDrag: (clientX: number) => void
  /** Keyboard: signed step in px (← negative, → positive). */
  onStep: (deltaPx: number) => void
  /** Double click restores the default. */
  onReset: () => void
  /** Grid position from the caller — the divider does not know where it lives. */
  style?: React.CSSProperties
}

/** Keyboard step; Shift moves faster. */
const STEP = 16
const STEP_FAST = 64

/** Draggable divider between two panels. A 5px grid item, so no absolute
 *  positioning is needed: the hit area is the whole column. */
export function ResizeHandle({ label, onDrag, onStep, onReset, style }: Props) {
  const dragging = useRef(false)

  // Unmounting mid-drag never fires pointerup, and without this cleanup the
  // class stays on the body and the whole app keeps the resize cursor.
  useEffect(
    () => () => {
      document.body.classList.remove('is-resizing')
    },
    [],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      style={style}
      onPointerDown={(e) => {
        // Primary button only: the context menu would steal the pointerup.
        if (e.button !== 0) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('is-resizing')
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        onDrag(e.clientX)
      }}
      onPointerUp={(e) => {
        // Without the guard, a pointerup with no matching capture throws.
        if (!dragging.current) return
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.classList.remove('is-resizing')
      }}
      onPointerCancel={() => {
        dragging.current = false
        document.body.classList.remove('is-resizing')
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const fast = e.shiftKey ? STEP_FAST : STEP
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          onStep(-fast)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          onStep(fast)
        } else if (e.key === 'Home') {
          e.preventDefault()
          onReset()
        }
      }}
      title={`${label} — drag, double click for the default`}
      className="group relative cursor-col-resize touch-none select-none bg-transparent
                 after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2
                 after:bg-line after:transition-colors
                 hover:after:bg-brand focus-visible:after:bg-brand
                 focus-visible:outline-none"
    />
  )
}
