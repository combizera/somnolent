import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShareDialog } from './ShareDialog'
import { useSession } from '../sessionStore'

describe('ShareDialog: controles no mesmo tamanho', () => {
  it('input e selects compartilham altura, largura e fundo', () => {
    useSession.getState().openShare()
    render(<ShareDialog />)

    const input = screen.getByPlaceholderText('my-laptop')
    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(2)

    const base = ['h-9', 'w-full', 'bg-app', 'border-line', 'rounded-md', 'px-3', 'text-sm']
    for (const el of [input, ...selects]) {
      for (const c of base) expect(el.className).toContain(c)
    }
    // sem isto o navegador desenha o controle nativo, quase preto
    for (const sel of selects) expect(sel.className).toContain('appearance-none')
  })

  it('os dois selects dividem a linha em colunas iguais', () => {
    useSession.getState().openShare()
    render(<ShareDialog />)
    const [role] = screen.getAllByRole('combobox')
    // Field > span.relative > select  →  a coluna do grid é o Field
    const column = role!.closest('label')!
    expect(column.parentElement!.className).toContain('grid-cols-2')
  })
})
