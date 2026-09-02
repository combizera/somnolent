import { create } from 'zustand'
import type { SendError, SendResult } from './lib/send'

/**
 * Estado transiente da sessão (não persiste): response atual, envio em
 * andamento e o diálogo de compartilhar — que abre de vários lugares (header,
 * collection aberta, painel de sync) e por isso não pode viver num só deles.
 */
interface SessionState {
  responses: Record<string, SendResult | SendError>
  sending: Record<string, boolean>
  /** `collectionId` = escopo já escolhido; null = o project inteiro. */
  share: { open: boolean; collectionId: string | null }
  setResponse: (requestId: string, response: SendResult | SendError) => void
  setSending: (requestId: string, sending: boolean) => void
  openShare: (collectionId?: string | null) => void
  closeShare: () => void
}

export const useSession = create<SessionState>()((set) => ({
  responses: {},
  sending: {},
  share: { open: false, collectionId: null },
  setResponse: (requestId, response) =>
    set((s) => ({ responses: { ...s.responses, [requestId]: response } })),
  setSending: (requestId, sending) =>
    set((s) => ({ sending: { ...s.sending, [requestId]: sending } })),
  openShare: (collectionId = null) => set({ share: { open: true, collectionId } }),
  closeShare: () => set({ share: { open: false, collectionId: null } }),
}))
