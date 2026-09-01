import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from './App'
import { useStore } from './store'

/**
 * Smoke test de render. Não é sobre pixels: é sobre a classe de bug que nem
 * `tsc` nem `oxlint` pegam — seletor de store que devolve referência nova a
 * cada chamada, que faz o React estourar "Maximum update depth exceeded".
 */

afterEach(cleanup)

describe('App', () => {
  it('renderiza a home sem entrar em loop de render', () => {
    expect(() => render(<App />)).not.toThrow()
    // o seed sempre traz uma collection com uma request de exemplo
    expect(screen.getByText('Somnolent')).toBeDefined()
  })

  it('mostra as collections do project aberto', () => {
    render(<App />)
    expect(screen.getAllByText('Exemplos').length).toBeGreaterThan(0)
  })

  it('sobrevive a uma collection aberta e a uma request selecionada', () => {
    const s = useStore.getState()
    const collection = s.collections[0]!
    s.openCollection(collection.id)
    s.selectRequest(s.requests[0]!.id)

    expect(() => render(<App />)).not.toThrow()
    expect(screen.getByDisplayValue('Exemplo — GET com vars')).toBeDefined()
  })

  it('sobrevive sem nenhuma collection — o seletor de env fica sem contexto', () => {
    const s = useStore.getState()
    s.openCollection(null)
    s.selectRequest(null)
    for (const c of [...s.collections]) s.deleteCollection(c.id)

    expect(() => render(<App />)).not.toThrow()
    expect(screen.getByText('Sem collection')).toBeDefined()
  })
})
