import { createContext, useContext } from 'react'

export interface ConfirmOptions {
  title: string
  /** One line on the consequence — what is lost, and whether it can be undone. */
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive action: red button. */
  danger?: boolean
}

export type Ask = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<Ask>(async () => false)

/** Replaces the browser `confirm()` with a dialog in the app's own UI. */
export function useConfirm(): Ask {
  return useContext(ConfirmContext)
}
