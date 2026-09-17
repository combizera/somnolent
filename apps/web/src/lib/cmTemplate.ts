import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import {
  Decoration,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view'
import { findOpenToken, rankVariables } from '@somnolent/core'

// What TemplateInput gives the URL field, for the CodeMirror body editor.

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g

/** Same trigger as the URL field, so `{{ bas` fires inside a JSON string too. */
export function variableSource(ctx: Record<string, string>) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos)
    const before = line.text.slice(0, context.pos - line.from)
    const token = findOpenToken(before, before.length)
    if (!token) return null

    const names = rankVariables(Object.keys(ctx), token.query)
    if (names.length === 0) return null

    return {
      from: line.from + token.start,
      // Keeps rankVariables' order; CodeMirror would re-sort.
      filter: false,
      options: names.map((name) => ({
        label: `{{ ${name} }}`,
        detail: ctx[name],
        type: 'variable',
        apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
          // Eat a `}}` already ahead of the caret instead of doubling it.
          const after = view.state.sliceDoc(to, Math.min(to + 4, view.state.doc.length))
          const closing = after.match(/^\s*\}\}/)
          const insert = `{{ ${name} }}`
          view.dispatch({
            changes: { from, to: to + (closing?.[0].length ?? 0), insert },
            selection: { anchor: from + insert.length },
          })
        },
      })),
    }
  }
}

const known = Decoration.mark({ class: 'cm-var' })
const unknown = Decoration.mark({ class: 'cm-var-missing' })

/** MatchDecorator repaints only changed lines; a full repass would stutter. */
function highlightVariables(ctx: Record<string, string>): Extension {
  const matcher = new MatchDecorator({
    regexp: TOKEN,
    decoration: (match) => (ctx[match[1]!] !== undefined ? known : unknown),
  })

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view)
      }
      update(update: ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}

/** Takes the resolved context, so switching environment repaints. */
export function templateVariables(ctx: Record<string, string>): Extension[] {
  return [
    highlightVariables(ctx),
    autocompletion({
      override: [variableSource(ctx)],
      activateOnTyping: true,
      selectOnOpen: true,
      icons: false,
    }),
  ]
}
