import { describe, expect, it } from 'vitest'

/**
 * Arquivo separado porque o store reidrata na importação do módulo: o
 * localStorage precisa estar sujo antes disso. É o teste que prova que o
 * saneamento está ligado no `persist`, e não só exportado.
 */
localStorage.setItem(
  'somnolent-layout',
  // `null` é o que sobra de um NaN gravado: JSON.stringify(NaN) === 'null'
  JSON.stringify({ state: { sidebarWidth: null, requestSplit: null }, version: 0 }),
)

const { useLayout, SIDEBAR, SPLIT_DEFAULT } = await import('./layoutStore')

describe('reidratação com valor corrompido no navegador', () => {
  it('não deixa o null guardado chegar no estado', () => {
    const { sidebarWidth, requestSplit } = useLayout.getState()
    expect(sidebarWidth).toBe(SIDEBAR.default)
    expect(requestSplit).toBe(SPLIT_DEFAULT)
    // sem isto o grid receberia `minmax(0,nullfr)` e quebraria a cada reload
    expect(Number.isFinite(sidebarWidth)).toBe(true)
    expect(Number.isFinite(requestSplit)).toBe(true)
  })
})
