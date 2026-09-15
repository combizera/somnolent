import { describe, expect, it } from 'vitest'
import { applyJsonPath } from './jsonPath'

/** A loja de livros dos exemplos da ajuda, pra testar o que a ajuda promete. */
const store = {
  store: {
    books: [
      { title: 'O Cortiço', price: 8 },
      { title: 'Dom Casmurro', price: 12 },
      { title: 'Memórias Póstumas', price: 5 },
    ],
  },
}

const body = JSON.stringify(store, null, 2)

const parse = (text: string) => JSON.parse(text) as unknown

describe('filtro JSONPath do body', () => {
  it('sem filtro, o body passa inteiro e não há contagem', () => {
    const out = applyJsonPath(store, body, '')
    expect(out.text).toBe(body)
    expect(out.matches).toBeNull()
    expect(out.error).toBeNull()
  })

  it('só espaço conta como sem filtro', () => {
    expect(applyJsonPath(store, body, '   ').text).toBe(body)
  })

  it('pega o campo de todos os itens', () => {
    const out = applyJsonPath(store, body, '$.store.books[*].title')
    expect(parse(out.text)).toEqual(['O Cortiço', 'Dom Casmurro', 'Memórias Póstumas'])
    expect(out.matches).toBe(3)
  })

  it('filtra por comparação', () => {
    const out = applyJsonPath(store, body, '$.store.books[?(@.price < 10)].title')
    expect(parse(out.text)).toEqual(['O Cortiço', 'Memórias Póstumas'])
  })

  it('fatia de trás pra frente', () => {
    const out = applyJsonPath(store, body, '$.store.books[-1:]')
    expect(parse(out.text)).toEqual([{ title: 'Memórias Póstumas', price: 5 }])
  })

  it('conta os itens com .length', () => {
    const out = applyJsonPath(store, body, '$.store.books.length')
    expect(parse(out.text)).toEqual([3])
  })

  it('um match só também sai dentro de array — a forma não depende do tamanho', () => {
    const out = applyJsonPath(store, body, '$.store.books[0].title')
    expect(parse(out.text)).toEqual(['O Cortiço'])
    expect(out.matches).toBe(1)
  })

  it('path que não casa com nada dá lista vazia, não erro', () => {
    const out = applyJsonPath(store, body, '$.store.magazines[*]')
    expect(parse(out.text)).toEqual([])
    expect(out.matches).toBe(0)
    expect(out.error).toBeNull()
  })

  it('path quebrado devolve o body inteiro com a mensagem do lado', () => {
    const out = applyJsonPath(store, body, '$.store.books[?(@.price <')
    expect(out.text).toBe(body)
    expect(out.matches).toBeNull()
    expect(out.error).toBe('Expressão JSONPath inválida')
  })

  it('filtra body de topo em array, que é a forma mais comum de response', () => {
    const list = [{ id: 1 }, { id: 2 }]
    const out = applyJsonPath(list, JSON.stringify(list), '$[*].id')
    expect(parse(out.text)).toEqual([1, 2])
  })
})
