import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Tema dos editores de código. As cores saem das variáveis do `@theme` em
 * index.css — a paleta continua definida num lugar só.
 */
const surface = EditorView.theme(
  {
    '&': { color: 'var(--color-ink)', backgroundColor: 'transparent' },
    '.cm-content': { caretColor: 'var(--color-brand)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-brand)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--color-brand-soft)',
    },
  },
  { dark: true },
)

/**
 * Chave e valor em cores diferentes — é o que faz um JSON grande ser legível.
 * As tags vêm do @lezer/json: PropertyName é a chave, String/Number/True/False/
 * Null são os valores, e vírgula/dois-pontos/chaves ficam apagados pra não
 * competir com o conteúdo.
 */
const jsonStyle = HighlightStyle.define(
  [
    { tag: t.propertyName, color: 'var(--color-syn-key)' },
    { tag: t.string, color: 'var(--color-syn-string)' },
    { tag: t.number, color: 'var(--color-syn-number)' },
    { tag: [t.bool, t.null], color: 'var(--color-syn-atom)', fontWeight: '600' },
    { tag: [t.separator, t.brace, t.squareBracket], color: 'var(--color-syn-punct)' },
    { tag: t.invalid, color: 'var(--color-bad)' },
  ],
  { themeType: 'dark' },
)

/** Passe junto das extensions e use `theme="none"` pra nada competir com isto. */
export const codeTheme = [surface, syntaxHighlighting(jsonStyle)]
