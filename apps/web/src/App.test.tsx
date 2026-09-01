import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'
import { useStore } from './store'

/**
 * Smoke test de render. Não é sobre pixels: é sobre a classe de bug que nem
 * `tsc` nem `oxlint` pegam — seletor de store que devolve referência nova a
 * cada chamada, que faz o React estourar "Maximum update depth exceeded".
 */

/**
 * O store é singleton de módulo, então um teste que apaga collections sujaria
 * os seguintes. Guarda o estado inicial e devolve ele antes de cada caso.
 */
const initialState = useStore.getState()
beforeEach(() => useStore.setState(initialState, true))
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

describe('pastas na sidebar', () => {
  /** Monta uma pasta com uma request dentro, na collection do seed. */
  function comPasta() {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.openCollection(collection.id)
    s.addSubCollection(collection.id, 'Pasta de teste')
    const folder = useStore.getState().collections.find((c) => c.name === 'Pasta de teste')!
    const requestId = useStore.getState().addRequest(folder.id)
    useStore.getState().updateRequest(requestId, { name: 'request escondida' })
    // addSubCollection abre o pai; o teste quer o estado de partida limpo
    useStore.getState().collapseFolders([folder.id])
    return folder
  }

  /** O nome da pasta também aparece na trilha do painel; olhamos só a sidebar. */
  const sidebar = () => within(screen.getByRole('complementary'))

  it('nasce fechada: o conteúdo não aparece até abrirem', () => {
    comPasta()
    render(<App />)
    expect(sidebar().getByText('Pasta de teste')).toBeDefined()
    expect(sidebar().queryByText('request escondida')).toBeNull()
  })

  it('clicar abre e o que estava aberto fica registrado pra sobreviver ao reload', () => {
    const folder = comPasta()
    render(<App />)

    fireEvent.click(sidebar().getByText('Pasta de teste'))

    expect(sidebar().getByText('request escondida')).toBeDefined()
    expect(useStore.getState().expandedFolders).toContain(folder.id)
  })

  it('apagar a pasta esquece que ela estava aberta', () => {
    const folder = comPasta()
    useStore.getState().expandFolders([folder.id])
    useStore.getState().deleteCollection(folder.id)
    expect(useStore.getState().expandedFolders).not.toContain(folder.id)
  })
})
