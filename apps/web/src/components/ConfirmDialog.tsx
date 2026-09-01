import { useCallback, useEffect, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { ConfirmContext, type Ask, type ConfirmOptions } from '../lib/confirm'

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  const ask = useCallback<Ask>(
    (options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  )

  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  useEffect(() => {
    if (!pending) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter') close(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6"
          onClick={() => close(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title}
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-line bg-panel p-5 shadow-2xl"
          >
            <div className="flex gap-3">
              {pending.danger && (
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-bad/15">
                  <TriangleAlert aria-hidden className="size-4.5 text-bad" />
                </span>
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-lg leading-snug font-semibold text-balance text-ink">
                  {pending.title}
                </h2>
                {pending.message && (
                  <p className="text-sm leading-relaxed text-ink-dim">{pending.message}</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="rounded-md px-3 py-1.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
              >
                {pending.cancelLabel ?? 'Cancelar'}
              </button>
              <button
                ref={confirmRef}
                onClick={() => close(true)}
                className={`rounded-md px-4 py-1.5 text-sm font-semibold text-white transition ${
                  pending.danger ? 'bg-bad hover:bg-bad/85' : 'bg-brand hover:bg-brand-hi'
                }`}
              >
                {pending.confirmLabel ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
