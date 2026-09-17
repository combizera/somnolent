import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** Colors come from the `@theme` vars in index.css, so the palette stays in one place. */
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

/** Key and value in different colors is what makes a large JSON readable;
 *  punctuation stays dim so it does not compete with the content. */
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

/** Pass with the extensions and use `theme="none"` so nothing competes with this. */
export const codeTheme = [surface, syntaxHighlighting(jsonStyle)]
