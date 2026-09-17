import { describe, expect, it } from 'vitest'
import { applyJsonPath } from './jsonPath'

/** The bookstore from the help examples, to test what the help promises. */
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

describe('JSONPath body filter', () => {
  it('with no filter the whole body passes and there is no count', () => {
    const out = applyJsonPath(store, body, '')
    expect(out.text).toBe(body)
    expect(out.matches).toBeNull()
    expect(out.error).toBeNull()
  })

  it('whitespace only counts as no filter', () => {
    expect(applyJsonPath(store, body, '   ').text).toBe(body)
  })

  it('takes one field from every item', () => {
    const out = applyJsonPath(store, body, '$.store.books[*].title')
    expect(parse(out.text)).toEqual(['O Cortiço', 'Dom Casmurro', 'Memórias Póstumas'])
    expect(out.matches).toBe(3)
  })

  it('filters by comparison', () => {
    const out = applyJsonPath(store, body, '$.store.books[?(@.price < 10)].title')
    expect(parse(out.text)).toEqual(['O Cortiço', 'Memórias Póstumas'])
  })

  it('slices from the end', () => {
    const out = applyJsonPath(store, body, '$.store.books[-1:]')
    expect(parse(out.text)).toEqual([{ title: 'Memórias Póstumas', price: 5 }])
  })

  it('counts the items with .length', () => {
    const out = applyJsonPath(store, body, '$.store.books.length')
    expect(parse(out.text)).toEqual([3])
  })

  it('a single match still comes wrapped — the shape does not follow the size', () => {
    const out = applyJsonPath(store, body, '$.store.books[0].title')
    expect(parse(out.text)).toEqual(['O Cortiço'])
    expect(out.matches).toBe(1)
  })

  it('a path matching nothing gives an empty list, not an error', () => {
    const out = applyJsonPath(store, body, '$.store.magazines[*]')
    expect(parse(out.text)).toEqual([])
    expect(out.matches).toBe(0)
    expect(out.error).toBeNull()
  })

  it('a broken path returns the whole body with the message beside it', () => {
    const out = applyJsonPath(store, body, '$.store.books[?(@.price <')
    expect(out.text).toBe(body)
    expect(out.matches).toBeNull()
    expect(out.error).toBe('Invalid JSONPath expression')
  })

  it('filters an array at the top, the most common response shape', () => {
    const list = [{ id: 1 }, { id: 2 }]
    const out = applyJsonPath(list, JSON.stringify(list), '$[*].id')
    expect(parse(out.text)).toEqual([1, 2])
  })
})
