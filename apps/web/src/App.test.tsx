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

describe('path params (:id)', () => {
  /** Request limpa: sem query nem header, pra o assert falar só da URL. */
  function abrirRequestCom(url: string) {
    const s = useStore.getState()
    const request = s.requests[0]!
    s.selectRequest(request.id)
    s.updateRequest(request.id, { url, queryParams: [], headers: [] })
    return request.id
  }

  it('digitar :id na URL cria a linha na aba Params', () => {
    abrirRequestCom('{{ base_url }}/api/pushes/:push_id/force')
    render(<App />)
    expect(screen.getByText(':push_id')).toBeDefined()
  })

  it('sem :id na URL, nenhuma linha de path param aparece', () => {
    abrirRequestCom('{{ base_url }}/api/pushes')
    render(<App />)
    expect(screen.queryByText(/^:/)).toBeNull()
  })

  it('não confunde porta nem esquema com path param', () => {
    abrirRequestCom('https://api.com:8080/v1/pushes')
    render(<App />)
    expect(screen.queryByText(':8080')).toBeNull()
  })

  it('preencher o valor entra na URL final mostrada', () => {
    const id = abrirRequestCom('https://api.com/pushes/:push_id/force')
    useStore.getState().updateRequest(id, {
      pathParams: [{ id: 'p1', key: 'push_id', value: 'abc-123', enabled: true }],
    })
    render(<App />)
    // a linha "URL final" mostra o que vai ser enviado de verdade
    expect(screen.getByText('https://api.com/pushes/abc-123/force')).toBeDefined()
  })

  it('valor vazio não gera aviso de texto — a borda vermelha basta', () => {
    abrirRequestCom('https://api.com/pushes/:push_id/force')
    render(<App />)
    expect(screen.queryByText(/variáveis faltando/)).toBeNull()
    // a linha "URL final" mostra o :push_id cru, que é o que sairia no send
    const urlFinal = screen.getByText('URL final').parentElement!
    expect(urlFinal.textContent).toContain('https://api.com/pushes/:push_id/force')
  })

  it('a request continua enviável mesmo com path param vazio', () => {
    abrirRequestCom('https://api.com/pushes/:push_id/force')
    render(<App />)
    const enviar = screen.getByRole('button', { name: /Enviar/ }) as HTMLButtonElement
    expect(enviar.disabled).toBe(false)
  })
})

describe('editores de código', () => {
  it('quebram a linha em vez de abrir scroll lateral', () => {
    const s = useStore.getState()
    const id = s.requests[0]!.id
    s.selectRequest(id)
    s.updateRequest(id, {
      bodyType: 'json',
      body: JSON.stringify({ send: ['x'.repeat(400)] }),
    })
    const { container } = render(<App />)
    // há duas abas "Body" na tela (request e response); a primeira é a da request
    fireEvent.click(screen.getAllByRole('button', { name: /^Body/ })[0]!)

    // classe que o CodeMirror aplica quando lineWrapping está ligado
    expect(container.querySelector('.cm-lineWrapping')).not.toBeNull()
  })
})
