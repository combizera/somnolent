import { describe, expect, it } from 'vitest'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@codemirror/view'
import { foldAll, foldable, syntaxTree } from '@codemirror/language'
import { jsonFold, summarizeFold } from './jsonFold'

/** Item fat enough to outrun what the parser reaches in one pass. */
const item = (i: number) => ({
  id: 97131308 + i,
  source_url: `https://eproc1g.tjsp.jus.br/eproc/externo.php?idDocumento=${i}&hash=7bd9b10db589cb`,
  text: 'BUSCA E APREENSÃO EM ALIENAÇÃO FIDUCIÁRIA Nº 4168905-80.2026.8.26.0100/SP '.repeat(10),
  lawyers: [{ name: 'ROBERTA BEATRIZ DO NASCIMENTO', oab_state: 'SP' }],
})

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

function state(doc: string, extensions: unknown[]) {
  const view = new EditorView({ doc, extensions: extensions as never })
  const s = view.state
  view.destroy()
  return s
}

const foldAt = (s: ReturnType<typeof state>, n: number) => {
  const line = s.doc.line(n)
  return foldable(s, line.from, line.to)
}

describe('JSON fold without relying on the parser', () => {
  const grande = pretty({ current_page: 1, data: Array.from({ length: 400 }, (_, i) => item(i)) })

  it('the parser does not reach the end of a large response', () => {
    const s = state(grande, [json()])
    expect(syntaxTree(s).length).toBeLessThan(s.doc.length)
  })

  it('without the service, the root and the top array get no fold', () => {
    const s = state(grande, [json()])
    expect(foldAt(s, 1)).toBeNull()
    expect(foldAt(s, 3)).toBeNull()
  })

  it('with the service, both fold', () => {
    const s = state(grande, [json(), jsonFold])
    expect(foldAt(s, 1)).not.toBeNull()
    expect(foldAt(s, 3)).not.toBeNull()
  })

  it('the array fold stops at the `]`, leaving `"data": […]`', () => {
    const s = state(grande, [json(), jsonFold])
    const range = foldAt(s, 3)!
    expect(s.doc.sliceString(range.from, range.from + 1)).toBe('\n')
    expect(s.doc.sliceString(range.to, range.to + 1)).toBe(']')
  })

  it('a scalar line does not fold', () => {
    const s = state(grande, [json(), jsonFold])
    expect(foldAt(s, 2)).toBeNull()
  })

  it('an inner item still folds on its own', () => {
    const s = state(grande, [json(), jsonFold])
    const range = foldAt(s, 4)!
    expect(s.doc.sliceString(range.to, range.to + 1)).toBe('}')
  })

  it('a nested block closes at the right level, not at the first `]`', () => {
    const s = state(pretty({ a: [{ b: [1, 2] }], c: 1 }), [json(), jsonFold])
    const abre = s.doc.line(2)
    expect(abre.text.trim()).toBe('"a": [')
    const range = foldable(s, abre.from, abre.to)!
    // the closer is `a`'s `]`, after the inner object's `}`
    expect(s.doc.sliceString(range.to, range.to + 1)).toBe(']')
    expect(s.doc.lineAt(range.to).number).toBe(s.doc.lines - 2)
  })

  it('an empty array is no fold — stringify leaves `[]` on one line', () => {
    const s = state(pretty({ duplicates: [], merged: [] }), [json(), jsonFold])
    expect(foldAt(s, 2)).toBeNull()
  })
})

describe('counter of the folded block', () => {
  /** What the placeholder announces for the block opening at line `n`. */
  const resumoDa = (doc: string, n: number) => {
    const s = state(doc, [json(), jsonFold])
    const line = s.doc.line(n)
    return summarizeFold(s, foldable(s, line.from, line.to)!)
  }

  it('an array of scalars counts the items', () => {
    expect(resumoDa(pretty([1, 2, 3, 4, 5]), 1)).toBe('5 items')
  })

  it('an object counts the fields, not the items', () => {
    expect(resumoDa(pretty({ a: 1, b: 2, c: 3 }), 1)).toBe('3 fields')
  })

  it('does not count the `},` that only closes an item', () => {
    const doc = pretty([{ id: 1, nome: 'a' }, { id: 2, nome: 'b' }])
    expect(resumoDa(doc, 1)).toBe('2 items')
  })

  it('ignores what sits deeper: counts only the first level inside', () => {
    const doc = pretty({ data: [{ tags: [1, 2, 3, 4] }, { tags: [5] }], page: 1 })
    // root has 2 fields (data, page); `data` has 2 items
    expect(resumoDa(doc, 1)).toBe('2 fields')
    expect(resumoDa(doc, 2)).toBe('2 items')
  })

  it('holds up on the large response, the case indentation folding was for', () => {
    const grande = pretty({ current_page: 1, data: Array.from({ length: 400 }, (_, i) => item(i)) })
    expect(resumoDa(grande, 3)).toBe('400 items')
  })

  it('a string starting with a brace is no phantom item', () => {
    expect(resumoDa(pretty(['}', ']', 'ok']), 1)).toBe('3 items')
  })
})

describe('what shows on screen when it folds', () => {
  it('swaps the block for `↔ n ↔`, with the number highlighted', () => {
    const parent = document.body.appendChild(document.createElement('div'))
    const view = new EditorView({
      parent,
      doc: pretty({ data: [1, 2, 3], page: 1 }),
      extensions: [json(), jsonFold] as never,
    })

    foldAll(view)

    const marca = view.dom.querySelector('.cm-foldPlaceholder')!
    expect(marca.textContent).toBe('↔ 2 ↔')
    expect(marca.querySelector('.cm-foldCount')?.textContent).toBe('2')
    // The full label lives in the title: a bare number says nothing.
    expect(marca.getAttribute('title')).toBe('2 fields — click to expand')

    view.destroy()
  })
})
