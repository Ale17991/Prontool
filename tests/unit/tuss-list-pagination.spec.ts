/**
 * Verifica a logica de paginacao client-side usada pelo <TussListDialog>
 * (sem render — operamos sobre a mesma matematica que o componente roda).
 */
import { describe, expect, it } from 'vitest'

const PAGE_SIZE = 20

function paginate<T>(items: T[], page: number) {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const offset = (page - 1) * PAGE_SIZE
  return {
    visible: items.slice(offset, offset + PAGE_SIZE),
    total,
    totalPages,
  }
}

describe('TussListDialog pagination math', () => {
  it('handles empty list', () => {
    const r = paginate([], 1)
    expect(r.total).toBe(0)
    expect(r.totalPages).toBe(1)
    expect(r.visible).toHaveLength(0)
  })

  it('shows all items when total <= page size', () => {
    const items = Array.from({ length: 7 }, (_, i) => i)
    const r = paginate(items, 1)
    expect(r.visible).toHaveLength(7)
    expect(r.totalPages).toBe(1)
  })

  it('paginates 25 items into 2 pages', () => {
    const items = Array.from({ length: 25 }, (_, i) => i)
    const p1 = paginate(items, 1)
    const p2 = paginate(items, 2)
    expect(p1.totalPages).toBe(2)
    expect(p1.visible).toHaveLength(20)
    expect(p2.visible).toHaveLength(5)
  })

  it('paginates the 200-buffer into exactly 10 pages', () => {
    const items = Array.from({ length: 200 }, (_, i) => i)
    const r = paginate(items, 10)
    expect(r.totalPages).toBe(10)
    expect(r.visible).toHaveLength(20)
    expect(r.visible[0]).toBe(180)
  })
})
