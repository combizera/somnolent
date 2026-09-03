import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Largura dos painéis. Vive num store separado do workspace de propósito:
 * é escolha local de quem está na frente da tela, não conteúdo — não entra no
 * blob que o sync lê nem viaja pro colega.
 */

/** Sidebar em px: a lista de collections não precisa acompanhar a janela. */
export const SIDEBAR = { min: 200, default: 272, max: 520 } as const

/** Piso em px pra request e response — abaixo disso o painel não é usável. */
export const PANE_MIN = 320

/** Fração da área restante que fica com a request; o resto é da response. */
export const SPLIT_DEFAULT = 0.5

interface LayoutState {
  sidebarWidth: number
  requestSplit: number
  setSidebarWidth: (px: number) => void
  setRequestSplit: (fraction: number) => void
  resetSidebar: () => void
  resetSplit: () => void
}

/** NaN cai no piso: Math.max(NaN, lo) é NaN e vazaria pro grid e pro storage. */
const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo

/**
 * O que veio do navegador não é confiável: pode ser de uma versão anterior do
 * app, editado à mão, ou — o caso real — um `null`, porque `JSON.stringify(NaN)`
 * é `null`. O clamp dos setters não cobre isso: o `persist` injeta o valor
 * guardado direto no estado sem passar por eles, então um valor ruim gravado
 * uma vez sobreviveria a todo reload e quebraria o grid pra sempre.
 */
export function sanitizeLayout(persisted: unknown): Pick<
  LayoutState,
  'sidebarWidth' | 'requestSplit'
> {
  const saved = (persisted ?? {}) as Partial<Record<'sidebarWidth' | 'requestSplit', unknown>>
  const num = (v: unknown, lo: number, hi: number, padrao: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : padrao
  return {
    sidebarWidth: num(saved.sidebarWidth, SIDEBAR.min, SIDEBAR.max, SIDEBAR.default),
    requestSplit: num(saved.requestSplit, 0.05, 0.95, SPLIT_DEFAULT),
  }
}

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarWidth: SIDEBAR.default,
      requestSplit: SPLIT_DEFAULT,
      setSidebarWidth: (px) => set({ sidebarWidth: clamp(px, SIDEBAR.min, SIDEBAR.max) }),
      // O clamp aqui é só sanidade; o piso em px depende da largura da janela e
      // por isso é aplicado por quem arrasta, que sabe medir o container.
      setRequestSplit: (fraction) => set({ requestSplit: clamp(fraction, 0.05, 0.95) }),
      resetSidebar: () => set({ sidebarWidth: SIDEBAR.default }),
      resetSplit: () => set({ requestSplit: SPLIT_DEFAULT }),
    }),
    {
      name: 'somnolent-layout',
      // Só os dois números: guardar as funções junto não serve pra nada e
      // aumenta a chance de reidratar algo estranho.
      partialize: (s) => ({ sidebarWidth: s.sidebarWidth, requestSplit: s.requestSplit }),
      merge: (persisted, current) => ({ ...current, ...sanitizeLayout(persisted) }),
    },
  ),
)
