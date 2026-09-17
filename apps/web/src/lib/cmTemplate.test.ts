import { describe, expect, it } from 'vitest'
import { CompletionContext, autocompletion } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { json } from '@codemirror/lang-json'
import { codeTheme } from './codeTheme'
import { templateVariables, variableSource } from './cmTemplate'

const ctx = {
  base_url: 'https://stg.api.com',
  token: 'stg-token',
  base_path: '/v1',
}

/** Runs the completion with the caret where `|` sits. */
function completar(text: string) {
  const pos = text.indexOf('|')
  const doc = text.replace('|', '')
  const state = EditorState.create({ doc })
  return variableSource(ctx)(new CompletionContext(state, pos, false))
}

describe('{{ var }} autocomplete in the body editor', () => {
  it('opens inside a JSON string, not only on a loose line', () => {
    const result = completar('{\n  "cnj": "{{ ba|"\n}')
    expect(result?.options.map((o) => o.label)).toEqual(['{{ base_path }}', '{{ base_url }}'])
  })

  it('the order is the ranking one — prefix before a mid-string match', () => {
    const result = completar('{{ url|')
    expect(result?.options.map((o) => o.label)).toEqual(['{{ base_url }}'])
    // `filter: false` preserves the order; CodeMirror would re-sort.
    expect(result?.filter).toBe(false)
  })

  it('shows the resolved value of each variable', () => {
    const result = completar('{{ tok|')
    expect(result?.options[0]?.detail).toBe('stg-token')
  })

  it('suggests nothing outside an open {{', () => {
    expect(completar('{\n  "cnj": "500|"\n}')).toBeNull()
    // Nor for an already closed token: there is nothing left to complete.
    expect(completar('{{ token }}|')).toBeNull()
  })

  it('does not open an empty list when nothing matches', () => {
    expect(completar('{{ zzz|')).toBeNull()
  })

  it('replaces the whole token without doubling the braces already typed', () => {
    const doc = '{ "cnj": "{{ ba }}" }'
    const from = doc.indexOf('{{')
    const to = doc.indexOf(' }}') // caret where the partial name ends
    const view = new EditorView({ state: EditorState.create({ doc }) })
    const apply = variableSource(ctx)(new CompletionContext(view.state, to, false))!.options[1]!
      .apply as (v: EditorView, c: unknown, from: number, to: number) => void

    apply(view, null, from, to)

    expect(view.state.doc.toString()).toBe('{ "cnj": "{{ base_url }}" }')
    // Caret lands after the `}}` just written.
    expect(view.state.selection.main.head).toBe(from + '{{ base_url }}'.length)
    view.destroy()
  })
})

describe('{{ var }} painting in the editor', () => {
  /** Editor with the same extension pair the panel uses. */
  function montar(doc: string) {
    const parent = document.body.appendChild(document.createElement('div'))
    // The extra `autocompletion()` is what basicSetup already adds: a config
    // clash would throw "Config merge conflict".
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc, extensions: [autocompletion(), templateVariables(ctx)] }),
    })
    return view
  }

  it('marks a resolving variable and a missing one differently', () => {
    const view = montar('{ "url": "{{ base_url }}/x", "q": "{{ sumida }}" }')

    expect([...view.dom.querySelectorAll('.cm-var')].map((el) => el.textContent)).toEqual([
      '{{ base_url }}',
    ])
    expect([...view.dom.querySelectorAll('.cm-var-missing')].map((el) => el.textContent)).toEqual([
      '{{ sumida }}',
    ])

    view.destroy()
  })

  it('JSON highlighting nests INSIDE the mark, which the color rule assumes', () => {
    // With `json()` on, the syntax span nests inside the mark and its color
    // wins — the CSS depends on that nesting order.
    const parent = document.body.appendChild(document.createElement('div'))
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '[\n  "{{ base_url }}"\n]',
        extensions: [json(), codeTheme, templateVariables(ctx)],
      }),
    })

    const marca = view.dom.querySelector('.cm-var')!
    expect(marca.textContent).toBe('{{ base_url }}')
    // The string-colored child is what `.cm-var span` has to override.
    expect(marca.children.length).toBeGreaterThan(0)

    view.destroy()
  })

  it('follows the edit: closing the braces paints the token at once', () => {
    const view = montar('{ "url": "{{ token ')
    expect(view.dom.querySelector('.cm-var')).toBeNull()

    view.dispatch({ changes: { from: view.state.doc.length, insert: '}}' } })
    expect(view.dom.querySelector('.cm-var')?.textContent).toBe('{{ token }}')

    view.destroy()
  })
})
