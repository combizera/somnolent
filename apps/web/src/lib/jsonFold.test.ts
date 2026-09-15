import { describe, expect, it } from 'vitest'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@codemirror/view'
import { foldable, syntaxTree } from '@codemirror/language'
import { jsonFold } from './jsonFold'

/** Item gordo o bastante pra estourar o que o parser alcança numa passada. */
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

describe('fold do JSON sem depender do parser', () => {
  const grande = pretty({ current_page: 1, data: Array.from({ length: 400 }, (_, i) => item(i)) })

  it('o parser não alcança o fim de uma response grande', () => {
    const s = state(grande, [json()])
    expect(syntaxTree(s).length).toBeLessThan(s.doc.length)
  })

  it('sem o serviço, a raiz e o array de topo ficam sem fold', () => {
    const s = state(grande, [json()])
    expect(foldAt(s, 1)).toBeNull()
    expect(foldAt(s, 3)).toBeNull()
  })

  it('com o serviço, os dois dobram', () => {
    const s = state(grande, [json(), jsonFold])
    expect(foldAt(s, 1)).not.toBeNull()
    expect(foldAt(s, 3)).not.toBeNull()
  })

  it('o fold do array para no `]`, deixando `"data": […]`', () => {
    const s = state(grande, [json(), jsonFold])
    const range = foldAt(s, 3)!
    expect(s.doc.sliceString(range.from, range.from + 1)).toBe('\n')
    expect(s.doc.sliceString(range.to, range.to + 1)).toBe(']')
  })

  it('linha escalar não dobra', () => {
    const s = state(grande, [json(), jsonFold])
    expect(foldAt(s, 2)).toBeNull()
  })

  it('item de dentro continua dobrando sozinho', () => {
    const s = state(grande, [json(), jsonFold])
    const range = foldAt(s, 4)!
    expect(s.doc.sliceString(range.to, range.to + 1)).toBe('}')
  })

  it('bloco aninhado fecha no nível certo, não no primeiro `]` que aparece', () => {
    const s = state(pretty({ a: [{ b: [1, 2] }], c: 1 }), [json(), jsonFold])
    const abre = s.doc.line(2)
    expect(abre.text.trim()).toBe('"a": [')
    const range = foldable(s, abre.from, abre.to)!
    // o fecho é o `]` de `a`, depois do `}` do objeto de dentro
    expect(s.doc.sliceString(range.to, range.to + 1)).toBe(']')
    expect(s.doc.lineAt(range.to).number).toBe(s.doc.lines - 2)
  })

  it('array vazio não vira fold — o stringify deixa `[]` na mesma linha', () => {
    const s = state(pretty({ duplicates: [], merged: [] }), [json(), jsonFold])
    expect(foldAt(s, 2)).toBeNull()
  })
})
