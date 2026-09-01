import { createContext, useContext } from 'react'

export interface ConfirmOptions {
  title: string
  /** Uma linha explicando a consequência — o que se perde, e se dá pra voltar. */
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Ação destrutiva: botão vermelho. */
  danger?: boolean
}

export type Ask = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<Ask>(async () => false)

/** Substitui o `confirm()` do navegador por um diálogo com a UI do app. */
export function useConfirm(): Ask {
  return useContext(ConfirmContext)
}
