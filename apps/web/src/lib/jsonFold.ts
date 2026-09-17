import { codeFolding, foldService } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/** Folds by indentation, not by the syntax tree: on a megabyte response the
 *  incremental parser stops early and the root never gets an arrow. */
const foldRange = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart)
  const open = line.text.trimEnd()
  if (!open.endsWith('{') && !open.endsWith('[')) return null

  const indent = open.length - open.trimStart().length
  // Iterator instead of `doc.line(n)` in a loop: the top-level array scans the
  // whole document, and this runs on every viewport update.
  const iter = state.doc.iterLines(line.number + 1)
  let pos = line.to + 1
  for (const text of iter) {
    const inner = text.trimStart()
    if (inner) {
      const ind = text.length - inner.length
      // First line back at the outer level: fold through its closer so
      // `"data": […]` is left on a single line.
      if (ind <= indent) return { from: line.to, to: pos + ind }
    }
    pos += text.length + 1
  }
  return null
})

/**
 * How many items a folded block hides, as `[ ↔ 14 ↔ ]` in Insomnia. Counts by
 * indentation, like the fold itself. Returns a string: CodeMirror compares the
 * prepared value with `==`, and an object would never equal itself.
 */
export function summarizeFold(state: EditorState, range: { from: number; to: number }): string {
  const kind = state.doc.sliceString(range.from - 1, range.from) === '[' ? 'items' : 'fields'
  const first = state.doc.lineAt(range.from).number + 1
  const last = state.doc.lineAt(range.to).number

  let inner = -1
  let count = 0
  for (const text of state.doc.iterLines(first, last)) {
    const trimmed = text.trimStart()
    if (!trimmed) continue
    const indent = text.length - trimmed.length
    if (inner === -1) inner = indent
    // A closing `},` sits at the inner level but is not an item.
    if (indent === inner && trimmed[0] !== '}' && trimmed[0] !== ']') count++
  }
  return `${count} ${kind}`
}

/** `12 items` → `↔ 12 ↔`, number highlighted, arrows dimmed. */
function placeholder(onclick: (event: Event) => void, prepared: unknown): HTMLElement {
  const label = typeof prepared === 'string' ? prepared : ''
  const count = label.split(' ')[0] ?? '…'

  const el = document.createElement('span')
  el.className = 'cm-foldPlaceholder'
  el.title = `${label} — click to expand`
  el.setAttribute('aria-label', `${label} hidden, click to expand`)
  el.onclick = onclick

  const number = document.createElement('span')
  number.className = 'cm-foldCount'
  number.textContent = count
  el.append('↔ ', number, ' ↔')
  return el
}

/** Both together: the counter assumes the exact range this foldService returns. */
export const jsonFold = [
  foldRange,
  codeFolding({
    preparePlaceholder: summarizeFold,
    placeholderDOM: (_view, onclick, prepared) => placeholder(onclick, prepared),
  }),
]
