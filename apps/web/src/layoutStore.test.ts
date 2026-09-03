import { beforeEach, describe, expect, it } from 'vitest'
import { SIDEBAR, SPLIT_DEFAULT, useLayout } from './layoutStore'

const initial = useLayout.getState()
beforeEach(() => useLayout.setState(initial, true))

describe('layoutStore', () => {
  it('prende a sidebar entre o mínimo e o máximo', () => {
    useLayout.getState().setSidebarWidth(9999)
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.max)

    useLayout.getState().setSidebarWidth(-40)
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.min)
  })

  it('não deixa NaN entrar — ele vazaria pro grid e pro localStorage', () => {
    // NaN chega de uma divisão por zero quando o container ainda não tem
    // largura; Math.max(NaN, lo) é NaN, então o clamp precisa barrar antes.
    useLayout.getState().setSidebarWidth(Number.NaN)
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.min)

    useLayout.getState().setRequestSplit(Number.NaN)
    expect(Number.isFinite(useLayout.getState().requestSplit)).toBe(true)

    useLayout.getState().setRequestSplit(Number.POSITIVE_INFINITY)
    expect(Number.isFinite(useLayout.getState().requestSplit)).toBe(true)
  })

  it('reseta pros padrões', () => {
    useLayout.getState().setSidebarWidth(400)
    useLayout.getState().setRequestSplit(0.8)
    useLayout.getState().resetSidebar()
    useLayout.getState().resetSplit()

    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.default)
    expect(useLayout.getState().requestSplit).toBe(SPLIT_DEFAULT)
  })
})
