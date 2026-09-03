import { beforeEach, describe, expect, it } from 'vitest'
import { SIDEBAR, SPLIT_DEFAULT, sanitizeLayout, useLayout } from './layoutStore'

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

describe('o que volta do navegador', () => {
  it('null vira o padrão — JSON.stringify(NaN) é null, e ele iria direto pro grid', () => {
    expect(sanitizeLayout({ sidebarWidth: null, requestSplit: null })).toEqual({
      sidebarWidth: SIDEBAR.default,
      requestSplit: SPLIT_DEFAULT,
    })
  })

  it('valor fora de faixa é prendido, não descartado', () => {
    expect(sanitizeLayout({ sidebarWidth: 9999, requestSplit: 3 })).toEqual({
      sidebarWidth: SIDEBAR.max,
      requestSplit: 0.95,
    })
  })

  it('lixo de qualquer forma cai no padrão', () => {
    const padrao = { sidebarWidth: SIDEBAR.default, requestSplit: SPLIT_DEFAULT }
    expect(sanitizeLayout(undefined)).toEqual(padrao)
    expect(sanitizeLayout({})).toEqual(padrao)
    expect(sanitizeLayout({ sidebarWidth: '300', requestSplit: {} })).toEqual(padrao)
    expect(sanitizeLayout({ sidebarWidth: Number.NaN })).toEqual(padrao)
  })

  it('valor bom passa intacto', () => {
    expect(sanitizeLayout({ sidebarWidth: 300, requestSplit: 0.4 })).toEqual({
      sidebarWidth: 300,
      requestSplit: 0.4,
    })
  })
})
