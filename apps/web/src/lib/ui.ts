/** Classes e helpers de UI compartilhados pelos diálogos. */

/**
 * Base de todo controle de formulário. A altura é fixa de propósito: input e
 * select têm métricas internas diferentes, e sem `h-9` os dois nunca fecham
 * na mesma linha.
 */
export const controlClass =
  'h-9 w-full rounded-md border border-line bg-app px-3 text-sm text-ink transition focus:border-brand focus:outline-none'

export const inputClass = `${controlClass} placeholder:text-ink-faint`

/**
 * `appearance-none` não é detalhe: sem ele o navegador desenha o select nativo
 * — fundo quase preto e seta própria — ao lado de inputs no tom do app.
 * O chevron vem sobreposto pelo componente `Select`.
 */
export const selectClass = `${controlClass} cursor-pointer appearance-none pr-8 hover:border-line-soft`

export const fieldLabel = 'text-[10px] font-semibold tracking-wider text-ink-faint uppercase'

/** A chave viaja no fragmento: fragmento não chega ao servidor nem a log de acesso. */
export const linkFor = (key: string) => `${window.location.origin}/#k=${key}`
