import { foldService } from '@codemirror/language'

/**
 * Fold por indentação, sem passar pela árvore de sintaxe.
 *
 * O parser do CodeMirror é incremental e numa response de megabytes ele para
 * muito antes do fim — a raiz e o array grande ficam fora do trecho parseado e
 * nunca ganham seta, justo os dois que mais importam dobrar.
 *
 * O body é sempre `JSON.stringify(x, null, 2)`, então a indentação é regular e
 * o bloco fecha na primeira linha que volta ao nível de fora. Quebra de linha
 * dentro de string não atrapalha: o stringify escapa como `\n`.
 */
export const jsonFold = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart)
  const open = line.text.trimEnd()
  if (!open.endsWith('{') && !open.endsWith('[')) return null

  const indent = open.length - open.trimStart().length
  // Iterador em vez de `doc.line(n)` em loop: a linha do array de topo varre o
  // documento inteiro, e isso roda a cada atualização do viewport.
  const iter = state.doc.iterLines(line.number + 1)
  let pos = line.to + 1
  for (const text of iter) {
    const inner = text.trimStart()
    if (inner) {
      const ind = text.length - inner.length
      // Primeira linha de volta ao nível de fora: dobra até o fecho dela, pra
      // sobrar `"data": […]` numa linha só.
      if (ind <= indent) return { from: line.to, to: pos + ind }
    }
    pos += text.length + 1
  }
  return null
})
