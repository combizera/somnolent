import { JSONPath } from 'jsonpath-plus'

/** Filtered body — what the Body tab shows and the copy button takes. */
export interface Filtered {
  /** Editor text: the whole body when unfiltered, the matches when filtered. */
  text: string
  /** How many nodes matched; `null` when there is no valid filter to count. */
  matches: number | null
  /** Path that does not compile. The bar paints the input and shows this. */
  error: string | null
}

/** Results always come wrapped in an array: flattening would make `$.items[*]`
 *  change shape with the size of the response. */
export function applyJsonPath(data: unknown, body: string, query: string): Filtered {
  const path = query.trim()
  if (!path) return { text: body, matches: null, error: null }
  try {
    const found = JSONPath({ path, json: data as never, wrap: true }) as unknown[]
    return { text: JSON.stringify(found, null, 2), matches: found.length, error: null }
  } catch {
    // Whole body back, not a blank screen: while typing, every prefix is
    // invalid. The library's message is parser noise.
    return { text: body, matches: null, error: 'Invalid JSONPath expression' }
  }
}
