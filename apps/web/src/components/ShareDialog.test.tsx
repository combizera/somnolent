import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShareDialog } from './ShareDialog'
import { useSession } from '../sessionStore'

describe('ShareDialog: controls at the same size', () => {
  it('input and selects share height, width and background', () => {
    useSession.getState().openShare()
    render(<ShareDialog />)

    const input = screen.getByPlaceholderText('my-laptop')
    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(2)

    const base = ['h-9', 'w-full', 'bg-app', 'border-line', 'rounded-md', 'px-3', 'text-sm']
    for (const el of [input, ...selects]) {
      for (const c of base) expect(el.className).toContain(c)
    }
    // without this the browser draws the native control, nearly black
    for (const sel of selects) expect(sel.className).toContain('appearance-none')
  })

  it('the two selects split the row into equal columns', () => {
    useSession.getState().openShare()
    render(<ShareDialog />)
    const [role] = screen.getAllByRole('combobox')
    // Field > span.relative > select  →  the grid column is the Field
    const column = role!.closest('label')!
    expect(column.parentElement!.className).toContain('grid-cols-2')
  })
})
