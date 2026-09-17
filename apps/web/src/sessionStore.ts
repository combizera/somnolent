import { create } from 'zustand'
import type { SendError, SendResult } from './lib/send'

/** Transient session state (never persisted). The share dialog lives here because
 *  it opens from several places and cannot belong to any one of them. */
interface SessionState {
  responses: Record<string, SendResult | SendError>
  sending: Record<string, boolean>
  /** `collectionId` = scope already chosen; null = the whole project. */
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
