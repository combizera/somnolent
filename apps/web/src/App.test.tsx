import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { useStore } from './store'
import { useSession } from './sessionStore'
import { SIDEBAR, useLayout } from './layoutStore'

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
const initialLayout = useLayout.getState()
beforeEach(() => {
  useStore.setState(initialState, true)
  useSession.setState(initialSession, true)
  useLayout.setState(initialLayout, true)
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

    fireEvent.click(screen.getByTitle('Copiar o que está na tela'))

    await waitFor(() => expect(escrito).toHaveLength(1))
    // o que vai pro clipboard é o texto indentado que o editor mostra
    expect(escrito[0]).toBe('{\n  "nome": "ygor",\n  "total": 42\n}')
    await waitFor(() => expect(screen.getByText('Copiado')).toBeDefined())
  })

  it('sem response, não existe botão de copiar', () => {
    useStore.getState().selectRequest(useStore.getState().requests[0]!.id)
    render(<App />)
    expect(screen.queryByTitle('Copiar o que está na tela')).toBeNull()
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

  it('todos os controles da direita fecham na mesma altura', () => {
    const { container } = render(<App />)
    const cluster = container.querySelector('header')!.lastElementChild!

    // project · compartilhar · sync · environment
    expect(cluster.children.length).toBe(4)
    const alturas = [...cluster.children].map(
      (el) => el.className.match(/\bh-\d+\b/)?.[0] ?? 'sem altura fixa',
    )
    // Sem altura fixa cada controle fecha na métrica do próprio conteúdo — o
    // select num tamanho, o botão de ícone noutro, a bolinha de status noutro.
    expect(new Set(alturas)).toEqual(new Set(['h-9']))
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

describe('painel de sync', () => {
  function conectado() {
    const project = useStore.getState().projects[0]!
    useStore.setState({
      connection: {
        key: 'somn_x',
        scope: 'project',
        role: 'write',
        label: 'Esta máquina',
        projectId: project.id,
        projectName: project.name,
        collectionId: null,
      },
      lastSyncAt: new Date().toISOString(),
    })
    // o painel lista chaves ao abrir; sem isto o jsdom reclama de fetch
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
  }

  it('mostra os fatos da conexão sem rótulo em caixa alta', () => {
    conectado()
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Sync/ }))

    expect(screen.getByText('Project inteiro')).toBeDefined()
    expect(screen.getByText('Leitura e escrita')).toBeDefined()
    expect(screen.getByText('Esta máquina')).toBeDefined()
    expect(screen.getByText(/Sincronizado agora mesmo/)).toBeDefined()

    // O bloco de fatos não usa mais o rótulo tracked-out em maiúsculas, que era
    // o que deixava chave e valor desalinhados em duas colunas.
    expect(screen.queryByText('Compartilhado')).toBeNull()
    expect(screen.queryByText('Último sync')).toBeNull()
    expect(container.querySelector('dl')).toBeNull()

    // os três fatos moram na mesma linha: mesmo pai, sem flex-wrap
    const linha = screen.getByText('Project inteiro').closest('div')!
    expect(linha.contains(screen.getByText('Leitura e escrita'))).toBe(true)
    expect(linha.contains(screen.getByText('Esta máquina'))).toBe(true)
    expect(linha.className).not.toContain('flex-wrap')

    vi.unstubAllGlobals()
  })

  it('a lista de chaves tem teto e rola', () => {
    conectado()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Sync/ }))

    const lista = screen.getByText('Chaves ativas').parentElement!.querySelector('.overflow-y-auto')
    expect(lista).not.toBeNull()
    expect(lista!.className).toMatch(/max-h-/)

    vi.unstubAllGlobals()
  })
})

describe('redimensionar os painéis', () => {
  /**
   * jsdom não faz layout: sem forjar o rect, `box.width` é 0 e o clamp acharia
   * que a janela não cabe nada. 1400px é uma janela plausível.
   */
  function janelaDe(width: number) {
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, right: width, bottom: 800, width, height: 800, x: 0, y: 0, toJSON: () => ({}) }
    }
    return () => {
      Element.prototype.getBoundingClientRect = original
    }
  }

  function comRequest() {
    const s = useStore.getState()
    s.selectRequest(s.requests[0]!.id)
  }

  it('tem um divisor por junção: dois com request aberta, um sem', () => {
    comRequest()
    const { unmount } = render(<App />)
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    unmount()

    useStore.getState().selectRequest(null)
    render(<App />)
    expect(screen.getAllByRole('separator')).toHaveLength(1)
  })

  it('seta do teclado move a sidebar, e Shift move mais rápido', () => {
    const restaura = janelaDe(1400)
    comRequest()
    render(<App />)
    const divisor = screen.getByRole('separator', { name: 'Largura da sidebar' })

    fireEvent.keyDown(divisor, { key: 'ArrowRight' })
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.default + 16)

    fireEvent.keyDown(divisor, { key: 'ArrowRight', shiftKey: true })
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.default + 16 + 64)

    fireEvent.keyDown(divisor, { key: 'ArrowLeft' })
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.default + 64)
    restaura()
  })

  it('respeita o mínimo e o máximo da sidebar', () => {
    const restaura = janelaDe(1400)
    comRequest()
    render(<App />)
    const divisor = screen.getByRole('separator', { name: 'Largura da sidebar' })

    for (let i = 0; i < 60; i++) fireEvent.keyDown(divisor, { key: 'ArrowLeft', shiftKey: true })
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.min)

    for (let i = 0; i < 60; i++) fireEvent.keyDown(divisor, { key: 'ArrowRight', shiftKey: true })
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.max)
    restaura()
  })

  it('numa janela estreita a sidebar para antes do máximo pra não sufocar os painéis', () => {
    // 900px: 900 - 10 de divisores - 2×320 de piso = 250 de teto, bem abaixo do máximo
    const restaura = janelaDe(900)
    comRequest()
    render(<App />)
    const divisor = screen.getByRole('separator', { name: 'Largura da sidebar' })

    for (let i = 0; i < 60; i++) fireEvent.keyDown(divisor, { key: 'ArrowRight', shiftKey: true })
    expect(useLayout.getState().sidebarWidth).toBe(250)
    expect(useLayout.getState().sidebarWidth).toBeLessThan(SIDEBAR.max)
    restaura()
  })

  it('a divisão request/response não deixa nenhum lado abaixo do piso', () => {
    const restaura = janelaDe(1400)
    comRequest()
    render(<App />)
    const divisor = screen.getByRole('separator', { name: 'Divisão entre request e response' })

    // sobra = 1400 - 272 - 10 = 1118; piso de 320px = 0.2862 de fração
    const piso = 320 / 1118
    for (let i = 0; i < 60; i++) fireEvent.keyDown(divisor, { key: 'ArrowLeft', shiftKey: true })
    expect(useLayout.getState().requestSplit).toBeCloseTo(piso, 3)

    for (let i = 0; i < 60; i++) fireEvent.keyDown(divisor, { key: 'ArrowRight', shiftKey: true })
    expect(useLayout.getState().requestSplit).toBeCloseTo(1 - piso, 3)
    restaura()
  })

  it('duplo clique volta ao padrão', () => {
    const restaura = janelaDe(1400)
    comRequest()
    render(<App />)
    const divisor = screen.getByRole('separator', { name: 'Largura da sidebar' })

    fireEvent.keyDown(divisor, { key: 'ArrowRight', shiftKey: true })
    expect(useLayout.getState().sidebarWidth).not.toBe(SIDEBAR.default)

    fireEvent.doubleClick(divisor)
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.default)
    restaura()
  })

  it('sem request, a tela vazia ocupa a coluna que sobra — e só ela', () => {
    useStore.getState().selectRequest(null)
    const { container } = render(<App />)

    const main = container.querySelector('main')!
    // sidebar · divisor · painéis. A barra de abas não renderiza sem aba, e é
    // justamente por isso que os painéis não podem contar com auto-placement.
    expect(main.children).toHaveLength(3)
    expect(main.style.gridTemplateColumns.split(' ')).toHaveLength(3)
    expect(screen.queryByRole('tablist')).toBeNull()

    // `col-span-2` sobrou do grid antigo (sidebar + dois painéis, sem divisor):
    // hoje ele pediria uma 4ª coluna que não existe e o browser inventaria uma
    // implícita, jogando a tela vazia pra fora do lugar.
    const vazio = screen.getByRole('region', { name: 'Nenhuma request aberta' })
    expect(vazio.className).not.toContain('col-span')

    // Os painéis são a 3ª célula, presos na linha 2. Sem a linha explícita eles
    // subiriam pra linha da barra — que é `auto` — e ficariam com a altura do
    // conteúdo em vez da altura da janela.
    const paineis = main.children[2] as HTMLElement
    expect(paineis.style.gridColumn).toBe('3')
    expect(paineis.style.gridRow).toBe('2')
    expect(paineis.children).toHaveLength(1)
    expect(paineis.children[0]).toBe(vazio)
  })

  it('a largura entra no grid, não em style de cada painel', () => {
    comRequest()
    const { container } = render(<App />)
    const main = container.querySelector('main')!
    expect(main.style.gridTemplateColumns).toContain(`${SIDEBAR.default}px`)
    // Um divisor por grid: o da sidebar no de fora, o de request/response no de
    // dentro. Os dois continuam sendo coluna de 5px, e não style de painel.
    expect(main.style.gridTemplateColumns.match(/5px/g)).toHaveLength(1)
    const paineis = main.children[3] as HTMLElement
    expect(paineis.style.gridTemplateColumns.match(/5px/g)).toHaveLength(1)
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

describe('barra de abas', () => {
  /** Três requests na collection do seed, todas abertas em aba. */
  function tresAbas() {
    const s = useStore.getState()
    const collectionId = s.collections[0]!.id
    const projectId = s.openProjectId!
    const ids = ['t1', 't2', 't3']
    useStore.setState((st) => ({
      requests: [
        ...st.requests,
        ...ids.map((id) => ({
          ...st.requests[0]!,
          id,
          projectId,
          collectionId,
          name: `Aba ${id}`,
        })),
      ],
    }))
    ids.forEach((id) => useStore.getState().selectRequest(id))
    return ids
  }

  it('mostra uma aba por request aberta, com a ativa marcada', () => {
    tresAbas()
    render(<App />)

    const abas = screen.getAllByRole('tab')
    expect(abas.map((a) => a.textContent)).toEqual([
      expect.stringContaining('Aba t1'),
      expect.stringContaining('Aba t2'),
      expect.stringContaining('Aba t3'),
    ])
    expect(abas[2]!.getAttribute('aria-selected')).toBe('true')
    expect(abas[0]!.getAttribute('aria-selected')).toBe('false')
  })

  it('clicar numa aba troca a request aberta', () => {
    tresAbas()
    render(<App />)

    fireEvent.click(screen.getAllByRole('tab')[0]!)

    expect(useStore.getState().selectedRequestId).toBe('t1')
  })

  it('o X da aba fecha só ela', () => {
    tresAbas()
    render(<App />)

    fireEvent.click(screen.getByLabelText('Fechar Aba t1'))

    expect(useStore.getState().openTabs).toEqual(['t2', 't3'])
  })

  it('botão do meio fecha a aba', () => {
    tresAbas()
    render(<App />)

    // `fireEvent.auxClick` não existe nesta versão do RTL; o evento nativo vai.
    fireEvent(
      screen.getAllByRole('tab')[0]!,
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    )

    expect(useStore.getState().openTabs).toEqual(['t2', 't3'])
  })

  it('o direito na aba abre o menu com as três ações', () => {
    tresAbas()
    render(<App />)

    fireEvent.contextMenu(screen.getAllByRole('tab')[0]!, { clientX: 40, clientY: 20 })

    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Fechar',
      'Fechar as outras',
      'Fechar todas',
    ])
  })

  it('"fechar as outras" deixa só a que recebeu o clique', () => {
    tresAbas()
    render(<App />)

    fireEvent.contextMenu(screen.getAllByRole('tab')[0]!, { clientX: 40, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fechar as outras' }))

    expect(useStore.getState().openTabs).toEqual(['t1'])
    expect(useStore.getState().selectedRequestId).toBe('t1')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('"fechar todas" limpa a barra e ela desaparece', () => {
    tresAbas()
    render(<App />)

    fireEvent.contextMenu(screen.getAllByRole('tab')[1]!, { clientX: 40, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fechar todas' }))

    expect(useStore.getState().openTabs).toEqual([])
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('com uma aba só, o menu não oferece "fechar as outras"', () => {
    tresAbas()
    useStore.getState().closeOtherTabs('t2')
    render(<App />)

    fireEvent.contextMenu(screen.getAllByRole('tab')[0]!, { clientX: 40, clientY: 20 })

    expect(screen.queryByRole('menuitem', { name: 'Fechar as outras' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Fechar' })).toBeDefined()
  })

  it('o direito no vazio da barra só oferece "fechar todas"', () => {
    tresAbas()
    render(<App />)

    fireEvent.contextMenu(screen.getByRole('tablist'), { clientX: 400, clientY: 20 })

    const itens = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(itens.map((i) => i.textContent)).toEqual(['Fechar todas'])
  })

  it('Esc fecha o menu sem fechar aba', () => {
    tresAbas()
    render(<App />)

    fireEvent.contextMenu(screen.getAllByRole('tab')[0]!, { clientX: 40, clientY: 20 })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(useStore.getState().openTabs).toHaveLength(3)
  })

  it('a barra só mostra as abas da collection em contexto', () => {
    tresAbas()
    const s = useStore.getState()
    const outra = s.addCollection('Outra')
    useStore.setState((st) => ({
      requests: [
        ...st.requests,
        { ...st.requests[0]!, id: 'z1', collectionId: outra, name: 'De outra' },
      ],
    }))
    useStore.getState().selectRequest('z1')

    render(<App />)

    // as quatro abas existem no estado, mas a barra é de uma collection só
    expect(useStore.getState().openTabs).toHaveLength(4)
    expect(screen.getAllByRole('tab').map((a) => a.textContent)).toEqual([
      expect.stringContaining('De outra'),
    ])
  })
})

describe('filtro JSONPath no pé do body', () => {
  const body = JSON.stringify({
    data: [
      { id: 1, nome: 'ygor', tags: ['a'] },
      { id: 2, nome: 'dayane', tags: [] },
    ],
  })

  /** Response pronta na sessão, como se o envio tivesse voltado. */
  function comResponse(corpo: string) {
    const s = useStore.getState()
    const id = s.requests[0]!.id
    s.selectRequest(id)
    useSession.getState().setResponse(id, {
      ok: true,
      status: 200,
      statusText: 'OK',
      timeMs: 12,
      sizeBytes: corpo.length,
      headers: [{ key: 'content-type', value: 'application/json' }],
      body: corpo,
    })
    return id
  }

  /** O texto que o editor da response mostra — o da request tem o seu próprio. */
  function mostrado() {
    const painel = screen.getByLabelText('Filtro JSONPath').closest('section')
    return painel?.querySelector('.cm-content')?.textContent ?? ''
  }

  const filtrar = (path: string) =>
    fireEvent.change(screen.getByLabelText('Filtro JSONPath'), { target: { value: path } })

  it('body que não é JSON não ganha campo de filtro', () => {
    comResponse('<html>não sou json</html>')
    render(<App />)
    expect(screen.queryByLabelText('Filtro JSONPath')).toBeNull()
  })

  it('sem response, não existe barra de filtro', () => {
    useStore.getState().selectRequest(useStore.getState().requests[0]!.id)
    render(<App />)
    expect(screen.queryByLabelText('Filtro JSONPath')).toBeNull()
  })

  it('o path recorta o que o editor mostra', () => {
    comResponse(body)
    render(<App />)
    expect(mostrado()).toContain('"id"')

    filtrar('$.data[*].nome')
    const texto = mostrado()
    expect(texto).toContain('ygor')
    expect(texto).toContain('dayane')
    expect(texto).not.toContain('"id"')
  })

  it('conta os resultados, no singular quando é um só', () => {
    comResponse(body)
    render(<App />)

    filtrar('$.data[*].nome')
    expect(screen.getByText('2 resultados')).toBeDefined()

    filtrar('$.data[0].nome')
    expect(screen.getByText('1 resultado')).toBeDefined()
  })

  it('path que não casa com nada dá zero, não erro', () => {
    comResponse(body)
    render(<App />)
    filtrar('$.data[*].oab')
    expect(screen.getByText('0 resultados')).toBeDefined()
  })

  it('path quebrado avisa e deixa o body inteiro na tela', () => {
    comResponse(body)
    render(<App />)

    filtrar('$.data[?(@.id <')
    expect(screen.getByText('Expressão JSONPath inválida')).toBeDefined()
    // o que estava na tela continua lá — digitar um path não apaga a response
    expect(mostrado()).toContain('"id"')
  })

  it('apagar o filtro devolve o body inteiro', () => {
    comResponse(body)
    render(<App />)

    filtrar('$.data[*].nome')
    expect(mostrado()).not.toContain('"id"')

    filtrar('')
    expect(mostrado()).toContain('"id"')
  })

  it('Esc no campo limpa o filtro', () => {
    comResponse(body)
    render(<App />)

    filtrar('$.data[*].nome')
    const campo = screen.getByLabelText('Filtro JSONPath')
    fireEvent.keyDown(campo, { key: 'Escape' })

    expect((campo as HTMLInputElement).value).toBe('')
    expect(mostrado()).toContain('"id"')
  })

  it('copiar leva o recorte, não o body inteiro', async () => {
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

    comResponse(body)
    render(<App />)
    filtrar('$.data[*].nome')
    fireEvent.click(screen.getByTitle('Copiar o que está na tela'))

    await waitFor(() => expect(escrito).toHaveLength(1))
    expect(JSON.parse(escrito[0]!)).toEqual(['ygor', 'dayane'])
  })

  it('a ajuda abre com os exemplos e fecha no Esc', () => {
    comResponse(body)
    render(<App />)

    fireEvent.click(screen.getByLabelText('Ajuda do filtro JSONPath'))
    const ajuda = screen.getByRole('dialog', { name: 'Ajuda do filtro JSONPath' })
    expect(within(ajuda).getByText('$.store.books[*].title')).toBeDefined()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Ajuda do filtro JSONPath' })).toBeNull()
  })
})

describe('altura dos painéis', () => {
  /** jsdom não calcula layout; o que dá pra travar é a invariante que produz a
   *  altura certa — linha implícita é `auto` e mata o scroll do painel. */
  it('todo grid acima do painel de response declara a linha', () => {
    const s = useStore.getState()
    const id = s.requests[0]!.id
    s.selectRequest(id)
    useSession.getState().setResponse(id, {
      ok: true,
      status: 200,
      statusText: 'OK',
      timeMs: 1,
      sizeBytes: 2,
      headers: [],
      body: '{"a":1}',
    })
    render(<App />)

    let node = screen.getByLabelText('Filtro JSONPath').closest('section')!.parentElement
    let vistos = 0
    while (node && node.tagName !== 'BODY') {
      if (node.className.includes('grid')) {
        expect(node.style.gridTemplateRows).not.toBe('')
        vistos++
      }
      node = node.parentElement
    }
    // Sem isto, uma árvore sem grid nenhum passaria sem testar nada.
    expect(vistos).toBeGreaterThanOrEqual(2)
  })
})

describe('dobrar o JSON da response', () => {
  const grande = JSON.stringify({
    current_page: 1,
    data: [
      { id: 97131308, court: 'TJSP', lawyers: [{ name: 'ROBERTA', oab_state: 'SP' }] },
      { id: 97131305, court: 'TJSP', lawyers: [{ name: 'DAYANE', oab_state: 'GO' }] },
    ],
  })

  function comResponse(corpo: string) {
    const s = useStore.getState()
    const id = s.requests[0]!.id
    s.selectRequest(id)
    useSession.getState().setResponse(id, {
      ok: true,
      status: 200,
      statusText: 'OK',
      timeMs: 1,
      sizeBytes: corpo.length,
      headers: [],
      body: corpo,
    })
  }

  it('o editor da response tem gutter de fold', () => {
    comResponse(grande)
    render(<App />)
    const painel = screen.getByLabelText('Filtro JSONPath').closest('section')!
    expect(painel.querySelector('.cm-foldGutter')).not.toBeNull()
  })

  it('colapsar tudo esconde os itens; expandir devolve', () => {
    comResponse(grande)
    render(<App />)
    const painel = screen.getByLabelText('Filtro JSONPath').closest('section')!
    const texto = () => painel.querySelector('.cm-content')?.textContent ?? ''
    expect(texto()).toContain('ROBERTA')

    fireEvent.click(screen.getByLabelText('Colapsar tudo'))
    expect(texto()).not.toContain('ROBERTA')

    fireEvent.click(screen.getByLabelText('Expandir tudo'))
    expect(texto()).toContain('ROBERTA')
  })

  it('body que não é JSON não ganha os botões de dobrar', () => {
    comResponse('<html>oi</html>')
    render(<App />)
    expect(screen.queryByLabelText('Colapsar tudo')).toBeNull()
  })

  it('fora da aba Body os botões somem', () => {
    comResponse(grande)
    render(<App />)
    // Headers existe nos dois painéis; o que importa é o da response.
    const painel = screen.getByLabelText('Filtro JSONPath').closest('section')!
    fireEvent.click(within(painel).getByRole('button', { name: /Headers/ }))
    expect(screen.queryByLabelText('Colapsar tudo')).toBeNull()
  })
})
