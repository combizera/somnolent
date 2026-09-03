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

export const fieldLabel = 'text-xs font-semibold tracking-wider text-ink-faint uppercase'

/**
 * Controles do header. Mesma altura `h-9` dos controles de diálogo, pelo mesmo
 * motivo: select, botão de ícone e bolinha de status têm métricas internas
 * diferentes e, sem altura fixa, cada um fecha num tamanho na mesma linha.
 * A altura mora aqui — se cada componente definir a sua, elas divergem de novo.
 */
export const headerGroup =
  'flex h-9 items-stretch overflow-hidden rounded-md border border-line focus-within:border-brand'

/** Botão solto do header, quadrado, só ícone. */
export const headerButton =
  'flex h-9 items-center justify-center gap-1.5 rounded-md border border-line bg-panel px-2 text-ink-dim transition hover:bg-raised hover:text-ink'

/** Trecho do grupo que abriga ícone + select. O respiro à esquerda é o que
 *  separa o conteúdo da borda do grupo. */
export const headerGroupBody = 'flex items-center gap-2 border-r border-line bg-panel pr-1.5 pl-3.5'

/** Select dentro de um grupo do header: sem padding vertical — quem manda na
 *  altura é o grupo — e altura cheia pra área de clique cobrir o controle. */
export const headerSelect =
  'h-full cursor-pointer appearance-none bg-transparent pr-7 pl-0 text-sm font-medium text-ink focus:outline-none focus-visible:outline-none'

/** A chave viaja no fragmento: fragmento não chega ao servidor nem a log de acesso. */
export const linkFor = (key: string) => `${window.location.origin}/#k=${key}`
