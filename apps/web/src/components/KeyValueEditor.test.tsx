import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { KeyValue } from '@somnolent/core'
import { KeyValueEditor } from './KeyValueEditor'

afterEach(cleanup)

const rows: KeyValue[] = [
  { id: 'a', key: 'page', value: '1', enabled: true },
  { id: 'b', key: 'limit', value: '20', enabled: true },
  { id: 'c', key: 'sort', value: 'desc', enabled: true },
]

/** Renders the editor and hands back the onChange spy. */
function mount(items = rows) {
  const onChange = vi.fn()
  render(<KeyValueEditor items={items} onChange={onChange} ctx={{}} />)
  return onChange
}

/** Drags the row at `from` onto the row at `to`, by grip. */
function drag(from: number, to: number) {
  const grips = screen.getAllByRole('button', { name: 'Reorder' })
  // jsdom builds no dataTransfer; the component writes to it.
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => {} }
  const target = grips[to]!.parentElement!
  fireEvent.dragStart(grips[from]!, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
}

const keys = (onChange: ReturnType<typeof vi.fn>) =>
  (onChange.mock.calls[0]![0] as KeyValue[]).map((it) => it.key)

describe('reordering rows', () => {
  it('dragging up drops the row before its neighbour', () => {
    const onChange = mount()
    drag(2, 0)
    expect(keys(onChange)).toEqual(['sort', 'page', 'limit'])
  })

  it('dragging down drops the row after its neighbour', () => {
    const onChange = mount()
    drag(0, 2)
    expect(keys(onChange)).toEqual(['limit', 'sort', 'page'])
  })

  it('dropping a row on itself changes nothing', () => {
    const onChange = mount()
    drag(1, 1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reordering keeps the values with their keys', () => {
    const onChange = mount()
    drag(2, 0)
    const next = onChange.mock.calls[0]![0] as KeyValue[]
    expect(next[0]).toEqual({ id: 'c', key: 'sort', value: 'desc', enabled: true })
  })

  it('a disabled row keeps its state after the move', () => {
    const onChange = mount([rows[0]!, { ...rows[1]!, enabled: false }, rows[2]!])
    drag(1, 0)
    const next = onChange.mock.calls[0]![0] as KeyValue[]
    expect(next[0]).toMatchObject({ key: 'limit', enabled: false })
  })
})

describe('editing rows', () => {
  it('the grip is the only draggable part, so inputs stay selectable', () => {
    mount()
    const grip = screen.getAllByRole('button', { name: 'Reorder' })[0]!
    expect(grip.getAttribute('draggable')).toBe('true')
    expect(grip.parentElement!.getAttribute('draggable')).toBeNull()
  })

  it('adds an empty row at the end', () => {
    const onChange = mount()
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    expect(keys(onChange)).toEqual(['page', 'limit', 'sort', ''])
  })

  it('removes the row that was clicked, not the first one', () => {
    const onChange = mount()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]!)
    expect(keys(onChange)).toEqual(['page', 'sort'])
  })
})
