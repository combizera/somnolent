import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { useStore } from './store'
import { useSession } from './sessionStore'
import { SIDEBAR, useLayout } from './layoutStore'

/** Render smoke test, for the bug class neither `tsc` nor `oxlint` catches: a
 *  store selector returning a fresh reference on every call. */

/** The store is a module singleton, so a test that deletes collections would
 *  dirty the next ones. Restore the initial state before each case. */
const initialState = useStore.getState()
/** The sessionStore is a module singleton too: one case's response would show
 *  up in the next without this reset. */
const initialSession = useSession.getState()
const initialLayout = useLayout.getState()
beforeEach(() => {
  useStore.setState(initialState, true)
  useSession.setState(initialSession, true)
  useLayout.setState(initialLayout, true)
})
afterEach(cleanup)

describe('App', () => {
  it('renders home without falling into a render loop', () => {
    expect(() => render(<App />)).not.toThrow()
    // the seed always brings a collection with an example request
    expect(screen.getByText('Somnolent')).toBeDefined()
  })

  it('shows the collections of the open project', () => {
    render(<App />)
    expect(screen.getAllByText('Examples').length).toBeGreaterThan(0)
  })

  it('survives an open collection and a selected request', () => {
    const s = useStore.getState()
    const collection = s.collections[0]!
    s.openCollection(collection.id)
    s.selectRequest(s.requests[0]!.id)

    expect(() => render(<App />)).not.toThrow()
    expect(screen.getByDisplayValue('Example — GET with vars')).toBeDefined()
  })

  it('survives with no collection at all: the env picker loses its context', () => {
    const s = useStore.getState()
    s.openCollection(null)
    s.selectRequest(null)
    for (const c of [...s.collections]) s.deleteCollection(c.id)

    expect(() => render(<App />)).not.toThrow()
    expect(screen.getByText('No collection')).toBeDefined()
  })
})

describe('folders in the sidebar', () => {
  /** Builds a folder with one request inside, in the seed collection. */
  function comPasta() {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.openCollection(collection.id)
    s.addSubCollection(collection.id, 'Test folder')
    const folder = useStore.getState().collections.find((c) => c.name === 'Test folder')!
    const requestId = useStore.getState().addRequest(folder.id)
    useStore.getState().updateRequest(requestId, { name: 'hidden request' })
    // addSubCollection expands the parent; this test wants a clean start
    useStore.getState().collapseFolders([folder.id])
    return folder
  }

  /** The folder name also shows in the panel trail; look at the sidebar only. */
  const sidebar = () => within(screen.getByRole('complementary'))

  it('starts collapsed: the content stays hidden until opened', () => {
    comPasta()
    render(<App />)
    expect(sidebar().getByText('Test folder')).toBeDefined()
    expect(sidebar().queryByText('hidden request')).toBeNull()
  })

  it('clicking expands, and what was open is recorded to survive a reload', () => {
    const folder = comPasta()
    render(<App />)

    fireEvent.click(sidebar().getByText('Test folder'))

    expect(sidebar().getByText('hidden request')).toBeDefined()
    expect(useStore.getState().expandedFolders).toContain(folder.id)
  })

  it('deleting the folder forgets that it was open', () => {
    const folder = comPasta()
    useStore.getState().expandFolders([folder.id])
    useStore.getState().deleteCollection(folder.id)
    expect(useStore.getState().expandedFolders).not.toContain(folder.id)
  })
})

describe('path params (:id)', () => {
  /** Clean request: no query or header, so the assert speaks only of the URL. */
  function abrirRequestCom(url: string) {
    const s = useStore.getState()
    const request = s.requests[0]!
    s.selectRequest(request.id)
    s.updateRequest(request.id, { url, queryParams: [], headers: [] })
    return request.id
  }

  it('typing :id in the URL creates the row in the Params tab', () => {
    abrirRequestCom('{{ base_url }}/api/pushes/:push_id/force')
    render(<App />)
    expect(screen.getByText(':push_id')).toBeDefined()
  })

  it('with no :id in the URL, no path param row shows up', () => {
    abrirRequestCom('{{ base_url }}/api/pushes')
    render(<App />)
    expect(screen.queryByText(/^:/)).toBeNull()
  })

  it('does not mistake a port or a scheme for a path param', () => {
    abrirRequestCom('https://api.com:8080/v1/pushes')
    render(<App />)
    expect(screen.queryByText(':8080')).toBeNull()
  })

  it('filling the value reaches the final URL on screen', () => {
    const id = abrirRequestCom('https://api.com/pushes/:push_id/force')
    useStore.getState().updateRequest(id, {
      pathParams: [{ id: 'p1', key: 'push_id', value: 'abc-123', enabled: true }],
    })
    render(<App />)
    // the "Final URL" row shows what will actually be sent
    expect(screen.getByText('https://api.com/pushes/abc-123/force')).toBeDefined()
  })

  it('an empty value raises no text warning — the red border is enough', () => {
    abrirRequestCom('https://api.com/pushes/:push_id/force')
    render(<App />)
    expect(screen.queryByText(/missing variables/)).toBeNull()
    // the "Final URL" row shows the raw :push_id, which is what a send would use
    const urlFinal = screen.getByText('Final URL').parentElement!
    expect(urlFinal.textContent).toContain('https://api.com/pushes/:push_id/force')
  })

  it('the request stays sendable even with an empty path param', () => {
    abrirRequestCom('https://api.com/pushes/:push_id/force')
    render(<App />)
    const enviar = screen.getByRole('button', { name: /Send/ }) as HTMLButtonElement
    expect(enviar.disabled).toBe(false)
  })
})

describe('code editors', () => {
  it('wrap the line instead of opening a horizontal scroll', () => {
    const s = useStore.getState()
    const id = s.requests[0]!.id
    s.selectRequest(id)
    s.updateRequest(id, {
      bodyType: 'json',
      body: JSON.stringify({ send: ['x'.repeat(400)] }),
    })
    const { container } = render(<App />)
    // there are two "Body" tabs on screen; the first is the request one
    fireEvent.click(screen.getAllByRole('button', { name: /^Body/ })[0]!)

    // the class CodeMirror applies when lineWrapping is on
    expect(container.querySelector('.cm-lineWrapping')).not.toBeNull()
  })
})

describe('large JSON response', () => {
  /** Puts a ready response in the session, as if the send had come back. */
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

  it('what scrolls is CodeMirror, not a wrapper around it', () => {
    comResponse(grande)
    const { container } = render(<App />)

    const editor = container.querySelectorAll('.cm-editor')
    // two: the request body's and the response's
    expect(editor.length).toBeGreaterThanOrEqual(1)

    const scroller = container.querySelectorAll('.cm-scroller')
    expect(scroller.length).toBeGreaterThanOrEqual(1)

    // No ancestor of the response editor may be a scroll container: two nested
    // scrolls cancel out and the vertical one disappears.
    const resposta = container.querySelectorAll('.cm-editor')
    for (const ed of resposta) {
      let node = ed.parentElement
      while (node && node.tagName !== 'SECTION') {
        expect(node.className).not.toContain('overflow-y-auto')
        node = node.parentElement
      }
    }
  })

  it('the copy button takes the formatted JSON to the clipboard', async () => {
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

    fireEvent.click(screen.getByTitle('Copy what is on screen'))

    await waitFor(() => expect(escrito).toHaveLength(1))
    // what reaches the clipboard is the indented text the editor shows
    expect(escrito[0]).toBe('{\n  "nome": "ygor",\n  "total": 42\n}')
    await waitFor(() => expect(screen.getByText('Copied')).toBeDefined())
  })

  it('with no response, there is no copy button', () => {
    useStore.getState().selectRequest(useStore.getState().requests[0]!.id)
    render(<App />)
    expect(screen.queryByTitle('Copy what is on screen')).toBeNull()
  })

  it('paints key and value with the app palette colors', () => {
    comResponse(JSON.stringify({ nome: 'ygor', total: 42, ativo: true, apelido: null }))
    const { container } = render(<App />)

    // CodeMirror emits one class per HighlightStyle entry: key, string, number
    // and atom have distinct colors, so they are distinct classes.
    const classes = [...container.querySelectorAll('.cm-line span[class]')].map((el) =>
      el.getAttribute('class'),
    )
    expect(new Set(classes.filter((c) => c?.includes('ͼ'))).size).toBeGreaterThanOrEqual(4)

    // And the colors are ours, not the library's generic theme: CodeMirror
    // injects the HighlightStyle CSS into the head, so it can be checked there.
    const css = [...document.querySelectorAll('style')].map((el) => el.textContent).join('\n')
    for (const token of ['--color-syn-key', '--color-syn-string', '--color-syn-number']) {
      expect(css).toContain(token)
    }
  })
})

describe('header', () => {
  it('the logo goes home: closes the request and the collection', () => {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.openCollection(collection.id)
    s.selectRequest(s.requests[0]!.id)

    render(<App />)
    fireEvent.click(screen.getByTitle('Back to home'))

    expect(useStore.getState().selectedRequestId).toBeNull()
    expect(useStore.getState().openCollectionId).toBeNull()
  })

  it('search is icon only and opens the palette on click', () => {
    render(<App />)
    // no search text taking up the header
    expect(screen.queryByText('Search request…')).toBeNull()

    const botao = screen.getByRole('button', { name: 'Search request' })
    expect(botao.textContent).toBe('')

    fireEvent.click(botao)
    expect(screen.getByPlaceholderText(/Search requests by name/)).toBeDefined()
  })

  it('share is icon only, but still announced', () => {
    render(<App />)
    const botao = screen.getByRole('button', { name: 'Share this project' })
    expect(botao.textContent).toBe('')
  })

  it('every control on the right closes at the same height', () => {
    const { container } = render(<App />)
    const cluster = container.querySelector('header')!.lastElementChild!

    // project · share · sync · environment
    expect(cluster.children.length).toBe(4)
    const alturas = [...cluster.children].map(
      (el) => el.className.match(/\bh-\d+\b/)?.[0] ?? 'no fixed height',
    )
    // Without a fixed height each control closes on its own content metric:
    // the select at one size, the icon button at another.
    expect(new Set(alturas)).toEqual(new Set(['h-9']))
  })

  it('the sync trigger does not repeat the project name', () => {
    // With no connection the trigger would just say "Sync" and prove nothing:
    // the name was only duplicated with a key connected.
    const project = useStore.getState().projects[0]!
    useStore.setState({
      connection: {
        key: 'somn_x',
        scope: 'project',
        role: 'write',
        label: 'my Mac',
        projectId: project.id,
        projectName: project.name,
        collectionId: null,
      },
    })

    render(<App />)
    // the name shows once only, in the project picker
    expect(screen.queryAllByText(project.name)).toHaveLength(1)
  })

  it('with no environment chosen the label is "Base", not a negation', () => {
    const s = useStore.getState()
    s.selectRequest(s.requests[0]!.id)

    render(<App />)
    expect(screen.queryByText('No environment')).toBeNull()
    expect(screen.getByRole('option', { name: 'Base' })).toBeDefined()
  })

  it('focusing the env picker paints the group border, not the select', () => {
    const s = useStore.getState()
    s.selectRequest(s.requests[0]!.id)

    const { container } = render(<App />)
    const select = container.querySelector('select[title^="Active environment"]')!
    // the select draws no ring of its own...
    expect(select.className).toContain('focus-visible:outline-none')
    // ...and the group around it is what reacts to focus
    expect(select.closest('div.rounded-md')!.className).toContain('focus-within:border-brand')
  })
})

describe('sync panel', () => {
  function conectado() {
    const project = useStore.getState().projects[0]!
    useStore.setState({
      connection: {
        key: 'somn_x',
        scope: 'project',
        role: 'write',
        label: 'This machine',
        projectId: project.id,
        projectName: project.name,
        collectionId: null,
      },
      lastSyncAt: new Date().toISOString(),
    })
    // the panel lists keys on open; without this jsdom complains about fetch
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
  }

  it('shows the connection facts with no upper-case label', () => {
    conectado()
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Sync/ }))

    expect(screen.getByText('Whole project')).toBeDefined()
    expect(screen.getByText('Read and write')).toBeDefined()
    expect(screen.getByText('This machine')).toBeDefined()
    expect(screen.getByText(/Synced just now/)).toBeDefined()

    // The fact block no longer uses the tracked-out upper-case label that left
    // key and value misaligned in two columns.
    expect(screen.queryByText('Shared')).toBeNull()
    expect(screen.queryByText('Last sync')).toBeNull()
    expect(container.querySelector('dl')).toBeNull()

    // the three facts live on the same row: same parent, no flex-wrap
    const linha = screen.getByText('Whole project').closest('div')!
    expect(linha.contains(screen.getByText('Read and write'))).toBe(true)
    expect(linha.contains(screen.getByText('This machine'))).toBe(true)
    expect(linha.className).not.toContain('flex-wrap')

    vi.unstubAllGlobals()
  })

  it('the key list has a cap and scrolls', () => {
    conectado()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Sync/ }))

    const lista = screen.getByText('Active keys').parentElement!.querySelector('.overflow-y-auto')
    expect(lista).not.toBeNull()
    expect(lista!.className).toMatch(/max-h-/)

    vi.unstubAllGlobals()
  })
})

describe('resizing the panels', () => {
  /** jsdom does no layout: without a forged rect, `box.width` is 0 and the clamp
   *  would think nothing fits. 1400px is a plausible window. */
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

  it('one divider per junction: two with a request open, one without', () => {
    comRequest()
    const { unmount } = render(<App />)
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    unmount()

    useStore.getState().selectRequest(null)
    render(<App />)
    expect(screen.getAllByRole('separator')).toHaveLength(1)
  })

  it('an arrow key moves the sidebar, and Shift moves it faster', () => {
    const restaura = janelaDe(1400)
    comRequest()
    render(<App />)
    const divisor = screen.getByRole('separator', { name: 'Sidebar width' })

    fireEvent.keyDown(divisor, { key: 'ArrowRight' })
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.default + 16)

    fireEvent.keyDown(divisor, { key: 'ArrowRight', shiftKey: true })
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.default + 16 + 64)

    fireEvent.keyDown(divisor, { key: 'ArrowLeft' })
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.default + 64)
    restaura()
  })

  it('respects the sidebar minimum and maximum', () => {
    const restaura = janelaDe(1400)
    comRequest()
    render(<App />)
    const divisor = screen.getByRole('separator', { name: 'Sidebar width' })

    for (let i = 0; i < 60; i++) fireEvent.keyDown(divisor, { key: 'ArrowLeft', shiftKey: true })
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.min)

    for (let i = 0; i < 60; i++) fireEvent.keyDown(divisor, { key: 'ArrowRight', shiftKey: true })
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.max)
    restaura()
  })

  it('in a narrow window the sidebar stops before the maximum', () => {
    // 900px: 900 - 10 of dividers - 2×320 of floor = a 250 ceiling
    const restaura = janelaDe(900)
    comRequest()
    render(<App />)
    const divisor = screen.getByRole('separator', { name: 'Sidebar width' })

    for (let i = 0; i < 60; i++) fireEvent.keyDown(divisor, { key: 'ArrowRight', shiftKey: true })
    expect(useLayout.getState().sidebarWidth).toBe(250)
    expect(useLayout.getState().sidebarWidth).toBeLessThan(SIDEBAR.max)
    restaura()
  })

  it('the request/response split keeps neither side below the floor', () => {
    const restaura = janelaDe(1400)
    comRequest()
    render(<App />)
    const divisor = screen.getByRole('separator', { name: 'Request and response split' })

    // left over = 1400 - 272 - 10 = 1118; a 320px floor = a 0.2862 fraction
    const piso = 320 / 1118
    for (let i = 0; i < 60; i++) fireEvent.keyDown(divisor, { key: 'ArrowLeft', shiftKey: true })
    expect(useLayout.getState().requestSplit).toBeCloseTo(piso, 3)

    for (let i = 0; i < 60; i++) fireEvent.keyDown(divisor, { key: 'ArrowRight', shiftKey: true })
    expect(useLayout.getState().requestSplit).toBeCloseTo(1 - piso, 3)
    restaura()
  })

  it('double click restores the default', () => {
    const restaura = janelaDe(1400)
    comRequest()
    render(<App />)
    const divisor = screen.getByRole('separator', { name: 'Sidebar width' })

    fireEvent.keyDown(divisor, { key: 'ArrowRight', shiftKey: true })
    expect(useLayout.getState().sidebarWidth).not.toBe(SIDEBAR.default)

    fireEvent.doubleClick(divisor)
    expect(useLayout.getState().sidebarWidth).toBe(SIDEBAR.default)
    restaura()
  })

  it('with no request, the empty screen takes the leftover column only', () => {
    useStore.getState().selectRequest(null)
    const { container } = render(<App />)

    const main = container.querySelector('main')!
    // sidebar · divider · panels. The strip does not render without tabs, which
    // is exactly why the panels cannot rely on auto-placement.
    expect(main.children).toHaveLength(3)
    expect(main.style.gridTemplateColumns.split(' ')).toHaveLength(3)
    expect(screen.queryByRole('tablist')).toBeNull()

    // `col-span-2` is left over from the old grid: today it would ask for a 4th
    // column that does not exist and the browser would invent an implicit one.
    const vazio = screen.getByRole('region', { name: 'No request open' })
    expect(vazio.className).not.toContain('col-span')

    // The panels are the 3rd cell, pinned to row 2. Without the explicit row
    // they would rise to the strip's `auto` row and take the content height.
    const paineis = main.children[2] as HTMLElement
    expect(paineis.style.gridColumn).toBe('3')
    expect(paineis.style.gridRow).toBe('2')
    expect(paineis.children).toHaveLength(1)
    expect(paineis.children[0]).toBe(vazio)
  })

  it('the width goes in the grid, not in each panel style', () => {
    comRequest()
    const { container } = render(<App />)
    const main = container.querySelector('main')!
    expect(main.style.gridTemplateColumns).toContain(`${SIDEBAR.default}px`)
    // One divider per grid: the sidebar's outside, the request/response one
    // inside. Both remain a 5px column, never a panel style.
    expect(main.style.gridTemplateColumns.match(/5px/g)).toHaveLength(1)
    const paineis = main.children[3] as HTMLElement
    expect(paineis.style.gridTemplateColumns.match(/5px/g)).toHaveLength(1)
  })
})

describe('dragging a request', () => {
  /** Minimal dataTransfer: jsdom provides none. */
  const dt = () => ({ setData: () => {}, getData: () => '', effectAllowed: '', dropEffect: '' })

  function cenario() {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.openCollection(collection.id)
    s.addSubCollection(collection.id, 'Target')
    const folder = useStore.getState().collections.find((c) => c.name === 'Target')!
    const request = useStore.getState().requests.find((r) => r.collectionId === collection.id)!
    return { collection, folder, request }
  }

  const requestAtual = (id: string) => useStore.getState().requests.find((r) => r.id === id)!

  it('dropping on the folder moves the request inside it', () => {
    const { folder, request } = cenario()
    render(<App />)
    const sidebar = within(screen.getByRole('complementary'))

    const linha = sidebar.getByText(request.name)
    const pasta = sidebar.getByText('Target')

    fireEvent.dragStart(linha, { dataTransfer: dt() })
    fireEvent.dragOver(pasta, { dataTransfer: dt() })
    fireEvent.drop(pasta, { dataTransfer: dt() })

    expect(requestAtual(request.id).collectionId).toBe(folder.id)
  })

  it('passing over a row does not turn the target into the root', () => {
    const { collection, folder, request } = cenario()
    useStore.getState().expandFolders([folder.id])
    render(<App />)
    const sidebar = within(screen.getByRole('complementary'))

    const linha = sidebar.getByText(request.name)
    fireEvent.dragStart(linha, { dataTransfer: dt() })
    // dragOver on the folder and then the drop: if the event bubbled to <nav>,
    // the target would become "root" and the request would land outside
    const pasta = sidebar.getByText('Target')
    fireEvent.dragOver(pasta, { dataTransfer: dt() })
    fireEvent.drop(pasta, { dataTransfer: dt() })

    expect(requestAtual(request.id).collectionId).not.toBeNull()
    expect(requestAtual(request.id).collectionId).not.toBe(collection.id)
  })

  it('dropping in the open folder gap lands inside it, not outside', () => {
    const { folder, request } = cenario()
    useStore.getState().expandFolders([folder.id])
    render(<App />)
    const sidebar = within(screen.getByRole('complementary'))

    const linha = sidebar.getByText(request.name)
    fireEvent.dragStart(linha, { dataTransfer: dt() })
    // "Drop here" only exists mid-drag, hence after the dragStart
    const corpo = sidebar.getByText('Drop here').parentElement!
    fireEvent.dragOver(corpo, { dataTransfer: dt() })
    fireEvent.drop(corpo, { dataTransfer: dt() })

    expect(requestAtual(request.id).collectionId).toBe(folder.id)
  })

  it('dropping on empty space takes it out of the folder into the collection', () => {
    const { collection, folder, request } = cenario()
    useStore.getState().moveRequest(request.id, folder.id, 0)
    // the folder starts collapsed; expand it so the request is on screen
    useStore.getState().expandFolders([folder.id])
    render(<App />)
    const sidebar = within(screen.getByRole('complementary'))

    fireEvent.dragStart(sidebar.getByText(request.name), { dataTransfer: dt() })
    const nav = screen.getByRole('navigation')
    fireEvent.dragOver(nav, { dataTransfer: dt() })
    fireEvent.drop(nav, { dataTransfer: dt() })

    // inside a collection, "outside a folder" is the collection itself, not
    // the workspace root
    expect(requestAtual(request.id).collectionId).toBe(collection.id)
  })
})

describe('empty screen and deletion', () => {
  it('with no request open, shows the ways out instead of a dry blank', () => {
    const s = useStore.getState()
    s.selectRequest(null)
    s.openCollection(null)
    render(<App />)

    // the same labels exist in the sidebar; here the center area is what counts
    const main = within(screen.getByRole('region', { name: 'No request open' }))
    expect(main.getByText('Pick a collection')).toBeDefined()
    expect(main.getByText('New collection')).toBeDefined()
    expect(main.getByText('Import from Insomnia')).toBeDefined()
    expect(main.getByText('Search request')).toBeDefined()
  })

  it('inside a collection, the text switches to it', () => {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.selectRequest(null)
    s.openCollection(collection.id)
    render(<App />)

    const main = within(screen.getByRole('region', { name: 'No request open' }))
    expect(main.getAllByText(collection.name).length).toBeGreaterThan(0)
    expect(main.getByText('New request')).toBeDefined()
    // creating a collection makes no sense in here
    expect(main.queryByText('New collection')).toBeNull()
  })

  it('the collection list no longer has a delete button', () => {
    const s = useStore.getState()
    s.openCollection(null)
    render(<App />)
    const sidebar = within(screen.getByRole('complementary'))
    expect(sidebar.queryByLabelText('Delete collection')).toBeNull()
  })

  it('deleting a collection asks in an app dialog, not the browser one', async () => {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.openCollection(collection.id)
    render(<App />)

    fireEvent.click(screen.getByLabelText('Delete this collection'))

    const dialogo = screen.getByRole('alertdialog')
    expect(within(dialogo).getByText(`Delete the collection "${collection.name}"?`)).toBeDefined()
    // nothing was deleted just by opening it
    expect(useStore.getState().collections.some((c) => c.id === collection.id)).toBe(true)

    fireEvent.click(within(dialogo).getByText('Delete collection'))
    // the dialog resolves by promise: the delete lands on the next microtask
    await waitFor(() =>
      expect(useStore.getState().collections.some((c) => c.id === collection.id)).toBe(false),
    )
  })

  it('cancelling in the dialog deletes nothing', () => {
    const s = useStore.getState()
    const collection = s.collections.find((c) => c.parentId === null)!
    s.openCollection(collection.id)
    render(<App />)

    fireEvent.click(screen.getByLabelText('Delete this collection'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Cancel'))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useStore.getState().collections.some((c) => c.id === collection.id)).toBe(true)
  })
})

describe('tab strip', () => {
  /** Three requests in the seed collection, all opened as tabs. */
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
          name: `Tab ${id}`,
        })),
      ],
    }))
    ids.forEach((id) => useStore.getState().selectRequest(id))
    return ids
  }

  it('shows one tab per open request, with the active one marked', () => {
    tresAbas()
    render(<App />)

    const abas = screen.getAllByRole('tab')
    expect(abas.map((a) => a.textContent)).toEqual([
      expect.stringContaining('Tab t1'),
      expect.stringContaining('Tab t2'),
      expect.stringContaining('Tab t3'),
    ])
    expect(abas[2]!.getAttribute('aria-selected')).toBe('true')
    expect(abas[0]!.getAttribute('aria-selected')).toBe('false')
  })

  it('clicking a tab switches the open request', () => {
    tresAbas()
    render(<App />)

    fireEvent.click(screen.getAllByRole('tab')[0]!)

    expect(useStore.getState().selectedRequestId).toBe('t1')
  })

  it('the tab X closes that tab only', () => {
    tresAbas()
    render(<App />)

    fireEvent.click(screen.getByLabelText('Close Tab t1'))

    expect(useStore.getState().openTabs).toEqual(['t2', 't3'])
  })

  it('the middle button closes the tab', () => {
    tresAbas()
    render(<App />)

    // `fireEvent.auxClick` does not exist in this RTL version; the native one does.
    fireEvent(
      screen.getAllByRole('tab')[0]!,
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    )

    expect(useStore.getState().openTabs).toEqual(['t2', 't3'])
  })

  it('right-clicking a tab opens the menu with the three actions', () => {
    tresAbas()
    render(<App />)

    fireEvent.contextMenu(screen.getAllByRole('tab')[0]!, { clientX: 40, clientY: 20 })

    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Close',
      'Close others',
      'Close all',
    ])
  })

  it('"close others" leaves only the clicked one', () => {
    tresAbas()
    render(<App />)

    fireEvent.contextMenu(screen.getAllByRole('tab')[0]!, { clientX: 40, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close others' }))

    expect(useStore.getState().openTabs).toEqual(['t1'])
    expect(useStore.getState().selectedRequestId).toBe('t1')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('"close all" clears the strip and it disappears', () => {
    tresAbas()
    render(<App />)

    fireEvent.contextMenu(screen.getAllByRole('tab')[1]!, { clientX: 40, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close all' }))

    expect(useStore.getState().openTabs).toEqual([])
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('with a single tab, the menu offers no "close others"', () => {
    tresAbas()
    useStore.getState().closeOtherTabs('t2')
    render(<App />)

    fireEvent.contextMenu(screen.getAllByRole('tab')[0]!, { clientX: 40, clientY: 20 })

    expect(screen.queryByRole('menuitem', { name: 'Close others' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeDefined()
  })

  it('right-clicking the strip gap offers only "close all"', () => {
    tresAbas()
    render(<App />)

    fireEvent.contextMenu(screen.getByRole('tablist'), { clientX: 400, clientY: 20 })

    const itens = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(itens.map((i) => i.textContent)).toEqual(['Close all'])
  })

  it('Esc closes the menu without closing a tab', () => {
    tresAbas()
    render(<App />)

    fireEvent.contextMenu(screen.getAllByRole('tab')[0]!, { clientX: 40, clientY: 20 })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(useStore.getState().openTabs).toHaveLength(3)
  })

  it('the strip shows only the tabs of the collection in context', () => {
    tresAbas()
    const s = useStore.getState()
    const outra = s.addCollection('Other')
    useStore.setState((st) => ({
      requests: [
        ...st.requests,
        { ...st.requests[0]!, id: 'z1', collectionId: outra, name: 'From another' },
      ],
    }))
    useStore.getState().selectRequest('z1')

    render(<App />)

    // all four tabs exist in the state, but the strip is of one collection
    expect(useStore.getState().openTabs).toHaveLength(4)
    expect(screen.getAllByRole('tab').map((a) => a.textContent)).toEqual([
      expect.stringContaining('From another'),
    ])
  })
})

describe('JSONPath filter at the foot of the body', () => {
  const body = JSON.stringify({
    data: [
      { id: 1, nome: 'ygor', tags: ['a'] },
      { id: 2, nome: 'dayane', tags: [] },
    ],
  })

  /** Ready response in the session, as if the send had come back. */
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

  /** The text the response editor shows — the request one has its own. */
  function mostrado() {
    const painel = screen.getByLabelText('JSONPath filter').closest('section')
    return painel?.querySelector('.cm-content')?.textContent ?? ''
  }

  const filtrar = (path: string) =>
    fireEvent.change(screen.getByLabelText('JSONPath filter'), { target: { value: path } })

  it('a non-JSON body gets no filter field', () => {
    comResponse('<html>not json</html>')
    render(<App />)
    expect(screen.queryByLabelText('JSONPath filter')).toBeNull()
  })

  it('with no response, there is no filter bar', () => {
    useStore.getState().selectRequest(useStore.getState().requests[0]!.id)
    render(<App />)
    expect(screen.queryByLabelText('JSONPath filter')).toBeNull()
  })

  it('the path slices what the editor shows', () => {
    comResponse(body)
    render(<App />)
    expect(mostrado()).toContain('"id"')

    filtrar('$.data[*].nome')
    const texto = mostrado()
    expect(texto).toContain('ygor')
    expect(texto).toContain('dayane')
    expect(texto).not.toContain('"id"')
  })

  it('counts the results, in the singular when there is one', () => {
    comResponse(body)
    render(<App />)

    filtrar('$.data[*].nome')
    expect(screen.getByText('2 results')).toBeDefined()

    filtrar('$.data[0].nome')
    expect(screen.getByText('1 result')).toBeDefined()
  })

  it('a path matching nothing gives zero, not an error', () => {
    comResponse(body)
    render(<App />)
    filtrar('$.data[*].oab')
    expect(screen.getByText('0 results')).toBeDefined()
  })

  it('a broken path warns and leaves the whole body on screen', () => {
    comResponse(body)
    render(<App />)

    filtrar('$.data[?(@.id <')
    expect(screen.getByText('Invalid JSONPath expression')).toBeDefined()
    // what was on screen stays there: typing a path does not erase the response
    expect(mostrado()).toContain('"id"')
  })

  it('clearing the filter gives the whole body back', () => {
    comResponse(body)
    render(<App />)

    filtrar('$.data[*].nome')
    expect(mostrado()).not.toContain('"id"')

    filtrar('')
    expect(mostrado()).toContain('"id"')
  })

  it('Esc in the field clears the filter', () => {
    comResponse(body)
    render(<App />)

    filtrar('$.data[*].nome')
    const campo = screen.getByLabelText('JSONPath filter')
    fireEvent.keyDown(campo, { key: 'Escape' })

    expect((campo as HTMLInputElement).value).toBe('')
    expect(mostrado()).toContain('"id"')
  })

  it('copying takes the slice, not the whole body', async () => {
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
    fireEvent.click(screen.getByTitle('Copy what is on screen'))

    await waitFor(() => expect(escrito).toHaveLength(1))
    expect(JSON.parse(escrito[0]!)).toEqual(['ygor', 'dayane'])
  })

  it('the help opens with the examples and closes on Esc', () => {
    comResponse(body)
    render(<App />)

    fireEvent.click(screen.getByLabelText('JSONPath filter help'))
    const ajuda = screen.getByRole('dialog', { name: 'JSONPath filter help' })
    expect(within(ajuda).getByText('$.store.books[*].title')).toBeDefined()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'JSONPath filter help' })).toBeNull()
  })
})

describe('panel height', () => {
  /** jsdom computes no layout; what can be pinned is the invariant behind the
   *  right height — an implicit row is `auto` and kills the panel scroll. */
  it('every grid above the response panel declares its row', () => {
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

    let node = screen.getByLabelText('JSONPath filter').closest('section')!.parentElement
    let vistos = 0
    while (node && node.tagName !== 'BODY') {
      if (node.className.includes('grid')) {
        expect(node.style.gridTemplateRows).not.toBe('')
        vistos++
      }
      node = node.parentElement
    }
    // Without this, a tree with no grid at all would pass testing nothing.
    expect(vistos).toBeGreaterThanOrEqual(2)
  })
})

describe('folding the response JSON', () => {
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

  it('the response editor has a fold gutter', () => {
    comResponse(grande)
    render(<App />)
    const painel = screen.getByLabelText('JSONPath filter').closest('section')!
    expect(painel.querySelector('.cm-foldGutter')).not.toBeNull()
  })

  it('collapsing all hides the items; expanding gives them back', () => {
    comResponse(grande)
    render(<App />)
    const painel = screen.getByLabelText('JSONPath filter').closest('section')!
    const texto = () => painel.querySelector('.cm-content')?.textContent ?? ''
    expect(texto()).toContain('ROBERTA')

    fireEvent.click(screen.getByLabelText('Collapse all'))
    expect(texto()).not.toContain('ROBERTA')

    fireEvent.click(screen.getByLabelText('Expand all'))
    expect(texto()).toContain('ROBERTA')
  })

  it('a non-JSON body gets no fold buttons', () => {
    comResponse('<html>hi</html>')
    render(<App />)
    expect(screen.queryByLabelText('Collapse all')).toBeNull()
  })

  it('outside the Body tab the buttons go away', () => {
    comResponse(grande)
    render(<App />)
    // Headers exists in both panels; the response one is what matters.
    const painel = screen.getByLabelText('JSONPath filter').closest('section')!
    fireEvent.click(within(painel).getByRole('button', { name: /Headers/ }))
    expect(screen.queryByLabelText('Collapse all')).toBeNull()
  })
})

describe('request tabs', () => {
  /** Request panel tab labels, in on-screen order. */
  function abas() {
    const params = screen.getAllByRole('button', { name: /^Params/ })[0]!
    const strip = params.parentElement!
    return [...strip.children].map((el) => el.textContent?.replace(/\d+$/, '') ?? '')
  }

  it('follows the order stored in the layout, not the factory one', () => {
    const s = useStore.getState()
    s.selectRequest(s.requests[0]!.id)
    useLayout.getState().moveRequestTab('body', 'params')
    render(<App />)

    expect(abas()).toEqual(['Body', 'Params', 'Headers', 'Auth'])
  })

  it('dragging one tab over another reorders it and persists', () => {
    const s = useStore.getState()
    s.selectRequest(s.requests[0]!.id)
    render(<App />)

    const params = screen.getAllByRole('button', { name: /^Params/ })[0]!
    const auth = screen.getAllByRole('button', { name: /^Auth/ })[0]!
    // jsdom builds no dataTransfer; the component writes to it.
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => {} }
    fireEvent.dragStart(params, { dataTransfer })
    fireEvent.dragOver(auth, { dataTransfer })
    fireEvent.drop(auth, { dataTransfer })

    expect(useLayout.getState().requestTabs).toEqual(['headers', 'auth', 'params', 'body'])
    expect(abas()).toEqual(['Headers', 'Auth', 'Params', 'Body'])
  })
})

describe('Form body type', () => {
  /** Opens the Body tab of the selected request. */
  function abrirBody() {
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /^Body/ })[0]!)
  }

  it('switches to form and stores the rows in formBody', () => {
    const s = useStore.getState()
    const id = s.requests[0]!.id
    s.selectRequest(id)
    abrirBody()

    fireEvent.click(screen.getByRole('button', { name: 'Form' }))
    expect(useStore.getState().requests.find((r) => r.id === id)!.bodyType).toBe('form')

    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    expect(useStore.getState().requests.find((r) => r.id === id)!.formBody).toHaveLength(1)
  })

  it('a round trip between Form and JSON loses nothing already typed', () => {
    const s = useStore.getState()
    const id = s.requests[0]!.id
    s.selectRequest(id)
    s.updateRequest(id, { bodyType: 'json', body: '{"a": 1}' })
    abrirBody()

    fireEvent.click(screen.getByRole('button', { name: 'Form' }))
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))

    const request = useStore.getState().requests.find((r) => r.id === id)!
    expect(request.bodyType).toBe('json')
    expect(request.body).toBe('{"a": 1}')
  })
})
