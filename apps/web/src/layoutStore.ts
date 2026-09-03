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
    { name: 'somnolent-layout' },
  ),
)
