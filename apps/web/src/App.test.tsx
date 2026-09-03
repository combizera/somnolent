import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { useStore } from './store'
import { useSession } from './sessionStore'

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
/** O sessionStore também é singleton de módulo: uma response de um caso
 *  apareceria no seguinte se não voltasse ao zero aqui. */
const initialSession = useSession.getState()
beforeEach(() => {
  useStore.setState(initialState, true)
  useSession.setState(initialSession, true)
})
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

describe('response de JSON grande', () => {
  /** Coloca uma response pronta na sessão, como se o envio tivesse voltado. */
  function comResponse(body: string) {
    const s = useStore.getState()
    const id = s.requests[0]!.id
    s.selectRequest(id)
    useSession.getState().setResponse(id, {
      ok: true,
      status: 200,
      statusText: 'OK',
      timeMs: 12,
      sizeBytes: body.length,
      headers: [{ key: 'content-type', value: 'application/json' }],
      body,
    })
    return id
  }

  const grande = JSON.stringify({
    data: Array.from({ length: 200 }, (_, i) => ({
      id: i,
      nome: `advogado ${i}`,
      ativo: i % 2 === 0,
      total: i * 3.5,
      apelido: null,
    })),
  })

  it('quem rola é o CodeMirror, não um wrapper por fora dele', () => {
    comResponse(grande)
    const { container } = render(<App />)

    const editor = container.querySelectorAll('.cm-editor')
    // duas: a do body da request e a da response
    expect(editor.length).toBeGreaterThanOrEqual(1)

    const scroller = container.querySelectorAll('.cm-scroller')
    expect(scroller.length).toBeGreaterThanOrEqual(1)

    // Nenhum ancestral do editor da response pode ser um container de scroll:
    // dois scrolls aninhados se anulam e o vertical some.
    const resposta = container.querySelectorAll('.cm-editor')
    for (const ed of resposta) {
      let node = ed.parentElement
      while (node && node.tagName !== 'SECTION') {
        expect(node.className).not.toContain('overflow-y-auto')
        node = node.parentElement
      }
    }
  })

  it('o botão copiar leva o JSON formatado pro clipboard', async () => {
    const escrito: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string) => {
          escrito.push(t)
          return Promise.resolve()
        },
      },
    })

    comResponse('{"nome":"ygor","total":42}')
    render(<App />)

    fireEvent.click(screen.getByTitle('Copiar o body da response'))

    await waitFor(() => expect(escrito).toHaveLength(1))
    // o que vai pro clipboard é o texto indentado que o editor mostra
    expect(escrito[0]).toBe('{\n  "nome": "ygor",\n  "total": 42\n}')
    await waitFor(() => expect(screen.getByText('Copiado')).toBeDefined())
  })

  it('sem response, não existe botão de copiar', () => {
    useStore.getState().selectRequest(useStore.getState().requests[0]!.id)
    render(<App />)
    expect(screen.queryByTitle('Copiar o body da response')).toBeNull()
  })

  it('pinta chave e valor com as cores da paleta do app', () => {
    comResponse(JSON.stringify({ nome: 'ygor', total: 42, ativo: true, apelido: null }))
    const { container } = render(<App />)

    // O CodeMirror gera uma classe por estilo do HighlightStyle: chave, string,
    // número e átomo têm cores distintas, então são classes distintas.
    const classes = [...container.querySelectorAll('.cm-line span[class]')].map((el) =>
      el.getAttribute('class'),
    )
    expect(new Set(classes.filter((c) => c?.includes('ͼ'))).size).toBeGreaterThanOrEqual(4)

    // E as cores são as nossas, não as do tema genérico da lib: o CodeMirror
    // injeta o CSS do HighlightStyle no head, então dá pra conferir lá.
    const css = [...document.querySelectorAll('style')].map((el) => el.textContent).join('\n')
    for (const token of ['--color-syn-key', '--color-syn-string', '--color-syn-number']) {
      expect(css).toContain(token)
    }
  })
})

describe('header', () => {
  it('o logo volta pro início: fecha a request e a collection', () => {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.openCollection(collection.id)
    s.selectRequest(s.requests[0]!.id)

    render(<App />)
    fireEvent.click(screen.getByTitle('Voltar para o início'))

    expect(useStore.getState().selectedRequestId).toBeNull()
    expect(useStore.getState().openCollectionId).toBeNull()
  })

  it('a busca é só ícone e abre a paleta ao clicar', () => {
    render(<App />)
    // nenhum texto de busca ocupando o header
    expect(screen.queryByText('Buscar request…')).toBeNull()

    const botao = screen.getByRole('button', { name: 'Buscar request' })
    expect(botao.textContent).toBe('')

    fireEvent.click(botao)
    expect(screen.getByPlaceholderText(/Buscar request por nome/)).toBeDefined()
  })

  it('compartilhar é só ícone, mas continua anunciado', () => {
    render(<App />)
    const botao = screen.getByRole('button', { name: 'Compartilhar este project' })
    expect(botao.textContent).toBe('')
  })

  it('o gatilho do sync não repete o nome do project', () => {
    // Sem conexão o gatilho mostraria "Sync" e o teste não provaria nada — o
    // nome só era duplicado quando havia uma chave conectada.
    const project = useStore.getState().projects[0]!
    useStore.setState({
      connection: {
        key: 'somn_x',
        scope: 'project',
        role: 'write',
        label: 'meu Mac',
        projectId: project.id,
        projectName: project.name,
        collectionId: null,
      },
    })

    render(<App />)
    // o nome aparece uma vez só, no seletor de project
    expect(screen.queryAllByText(project.name)).toHaveLength(1)
  })

  it('sem environment escolhido o rótulo é "Base", não uma negação', () => {
    const s = useStore.getState()
    s.selectRequest(s.requests[0]!.id)

    render(<App />)
    expect(screen.queryByText('Sem environment')).toBeNull()
    expect(screen.getByRole('option', { name: 'Base' })).toBeDefined()
  })

  it('o foco do seletor de env pinta a borda do grupo, não o select', () => {
    const s = useStore.getState()
    s.selectRequest(s.requests[0]!.id)

    const { container } = render(<App />)
    const select = container.querySelector('select[title^="Environment ativo"]')!
    // o select não desenha anel próprio...
    expect(select.className).toContain('focus-visible:outline-none')
    // ...e o grupo em volta é quem reage ao foco
    expect(select.closest('div.rounded-md')!.className).toContain('focus-within:border-brand')
  })
})

describe('arrastar request', () => {
  /** dataTransfer mínimo: o jsdom não fornece um. */
  const dt = () => ({ setData: () => {}, getData: () => '', effectAllowed: '', dropEffect: '' })

  function cenario() {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.openCollection(collection.id)
    s.addSubCollection(collection.id, 'Destino')
    const folder = useStore.getState().collections.find((c) => c.name === 'Destino')!
    const request = useStore.getState().requests.find((r) => r.collectionId === collection.id)!
    return { collection, folder, request }
  }

  const requestAtual = (id: string) => useStore.getState().requests.find((r) => r.id === id)!

  it('soltar sobre a pasta move a request pra dentro dela', () => {
    const { folder, request } = cenario()
    render(<App />)
    const sidebar = within(screen.getByRole('complementary'))

    const linha = sidebar.getByText(request.name)
    const pasta = sidebar.getByText('Destino')

    fireEvent.dragStart(linha, { dataTransfer: dt() })
    fireEvent.dragOver(pasta, { dataTransfer: dt() })
    fireEvent.drop(pasta, { dataTransfer: dt() })

    expect(requestAtual(request.id).collectionId).toBe(folder.id)
  })

  it('passar por cima de uma linha não deixa o alvo virar a raiz', () => {
    const { collection, folder, request } = cenario()
    useStore.getState().expandFolders([folder.id])
    render(<App />)
    const sidebar = within(screen.getByRole('complementary'))

    const linha = sidebar.getByText(request.name)
    fireEvent.dragStart(linha, { dataTransfer: dt() })
    // dragOver na pasta e depois o drop nela: se o evento subisse pro <nav>,
    // o alvo viraria "raiz" e a request cairia em Sem pasta
    const pasta = sidebar.getByText('Destino')
    fireEvent.dragOver(pasta, { dataTransfer: dt() })
    fireEvent.drop(pasta, { dataTransfer: dt() })

    expect(requestAtual(request.id).collectionId).not.toBeNull()
    expect(requestAtual(request.id).collectionId).not.toBe(collection.id)
  })

  it('soltar no vão da pasta aberta cai na pasta, não fora dela', () => {
    const { folder, request } = cenario()
    useStore.getState().expandFolders([folder.id])
    render(<App />)
    const sidebar = within(screen.getByRole('complementary'))

    const linha = sidebar.getByText(request.name)
    fireEvent.dragStart(linha, { dataTransfer: dt() })
    // "Solte aqui" só existe durante o arraste — por isso vem depois do dragStart
    const corpo = sidebar.getByText('Solte aqui').parentElement!
    fireEvent.dragOver(corpo, { dataTransfer: dt() })
    fireEvent.drop(corpo, { dataTransfer: dt() })

    expect(requestAtual(request.id).collectionId).toBe(folder.id)
  })

  it('soltar na área vazia tira da pasta e deixa na collection aberta', () => {
    const { collection, folder, request } = cenario()
    useStore.getState().moveRequest(request.id, folder.id, 0)
    // pasta nasce fechada; abrir pra a request estar na tela
    useStore.getState().expandFolders([folder.id])
    render(<App />)
    const sidebar = within(screen.getByRole('complementary'))

    fireEvent.dragStart(sidebar.getByText(request.name), { dataTransfer: dt() })
    const nav = screen.getByRole('navigation')
    fireEvent.dragOver(nav, { dataTransfer: dt() })
    fireEvent.drop(nav, { dataTransfer: dt() })

    // dentro de uma collection, "fora de pasta" é a própria collection —
    // não a raiz do workspace
    expect(requestAtual(request.id).collectionId).toBe(collection.id)
  })
})

describe('tela vazia e exclusão', () => {
  it('sem request aberta, mostra os caminhos de saída em vez de um vazio seco', () => {
    const s = useStore.getState()
    s.selectRequest(null)
    s.openCollection(null)
    render(<App />)

    // os mesmos rótulos existem na sidebar; aqui interessa a área central
    const main = within(screen.getByRole('region', { name: 'Nenhuma request aberta' }))
    expect(main.getByText('Escolha uma collection')).toBeDefined()
    expect(main.getByText('Nova collection')).toBeDefined()
    expect(main.getByText('Importar do Insomnia')).toBeDefined()
    expect(main.getByText('Buscar request')).toBeDefined()
  })

  it('dentro de uma collection, o texto muda pra ela', () => {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.selectRequest(null)
    s.openCollection(collection.id)
    render(<App />)

    const main = within(screen.getByRole('region', { name: 'Nenhuma request aberta' }))
    expect(main.getAllByText(collection.name).length).toBeGreaterThan(0)
    expect(main.getByText('Nova request')).toBeDefined()
    // criar collection não faz sentido aqui dentro
    expect(main.queryByText('Nova collection')).toBeNull()
  })

  it('a lista de collections não tem mais botão de apagar', () => {
    const s = useStore.getState()
    s.openCollection(null)
    render(<App />)
    const sidebar = within(screen.getByRole('complementary'))
    expect(sidebar.queryByLabelText('Excluir collection')).toBeNull()
  })

  it('apagar collection pede confirmação num diálogo do app, não do navegador', async () => {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.openCollection(collection.id)
    render(<App />)

    fireEvent.click(screen.getByLabelText('Excluir esta collection'))

    const dialogo = screen.getByRole('alertdialog')
    expect(within(dialogo).getByText(`Excluir a collection "${collection.name}"?`)).toBeDefined()
    // nada foi apagado só por abrir
    expect(useStore.getState().collections.some((c) => c.id === collection.id)).toBe(true)

    fireEvent.click(within(dialogo).getByText('Excluir collection'))
    // o diálogo resolve por promise: a exclusão acontece no microtask seguinte
    await waitFor(() =>
      expect(useStore.getState().collections.some((c) => c.id === collection.id)).toBe(false),
    )
  })

  it('cancelar no diálogo não apaga nada', () => {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.openCollection(collection.id)
    render(<App />)

    fireEvent.click(screen.getByLabelText('Excluir esta collection'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Cancelar'))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useStore.getState().collections.some((c) => c.id === collection.id)).toBe(true)
  })
})
