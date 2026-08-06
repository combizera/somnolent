import { create } from 'zustand'
import type { SendError, SendResult } from './lib/send'

/** Estado transiente da sessão (não persiste): response atual e envio em andamento. */
interface SessionState {
  responses: Record<string, SendResult | SendError>
  sending: Record<string, boolean>
  setResponse: (requestId: string, response: SendResult | SendError) => void
  setSending: (requestId: string, sending: boolean) => void
}

export const useSession = create<SessionState>()((set) => ({
  responses: {},
  sending: {},
  setResponse: (requestId, response) =>
    set((s) => ({ responses: { ...s.responses, [requestId]: response } })),
  setSending: (requestId, sending) =>
    set((s) => ({ sending: { ...s.sending, [requestId]: sending } })),
}))
