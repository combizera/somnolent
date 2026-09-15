import { JSONPath } from 'jsonpath-plus'

/** Body filtrado — o que a aba Body mostra e o botão de copiar leva. */
export interface Filtered {
  /** Texto no editor: o body inteiro sem filtro, os matches com filtro. */
  text: string
  /** Quantos nós casaram; `null` quando não há filtro válido pra contar. */
  matches: number | null
  /** Path que não compila. A barra pinta o input e mostra isto. */
  error: string | null
}

/**
 * O resultado vem sempre dentro de um array, mesmo com um match só: achatar
 * faria `$.items[*]` mudar de forma conforme o tamanho da response.
 */
export function applyJsonPath(data: unknown, body: string, query: string): Filtered {
  const path = query.trim()
  if (!path) return { text: body, matches: null, error: null }
  try {
    const found = JSONPath({ path, json: data as never, wrap: true }) as unknown[]
    return { text: JSON.stringify(found, null, 2), matches: found.length, error: null }
  } catch {
    // Body inteiro de volta, não tela vazia: digitando, todo prefixo é
    // inválido. A mensagem da lib é ruído de parser.
    return { text: body, matches: null, error: 'Expressão JSONPath inválida' }
  }
}
