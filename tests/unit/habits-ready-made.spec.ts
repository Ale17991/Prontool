/**
 * Checklists de hábitos prontos.
 *
 * Um id repetido aqui colidiria com o UNIQUE (checklist, item, dia) das
 * marcações e faria dois hábitos compartilharem a mesma marcação — a pessoa
 * marcaria "bebeu água" e veria "treinou" marcar junto.
 */
import { describe, expect, it } from 'vitest'
import { READY_MADE_CHECKLISTS, readyMadeChecklist } from '@/lib/core/habits/ready-made'

describe('catálogo de checklists prontos', () => {
  it('tem checklists e nenhum slug duplicado', () => {
    expect(READY_MADE_CHECKLISTS.length).toBeGreaterThan(0)
    const slugs = READY_MADE_CHECKLISTS.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  for (const c of READY_MADE_CHECKLISTS) {
    describe(c.title, () => {
      it('tem título, dica e ao menos um hábito', () => {
        expect(c.title.trim().length).toBeGreaterThan(0)
        expect(c.hint.trim().length).toBeGreaterThan(0)
        expect(c.items.length).toBeGreaterThan(0)
      })

      it('ids de hábito são únicos dentro do checklist', () => {
        const ids = c.items.map((i) => i.id)
        expect(new Set(ids).size, `ids repetidos em ${c.slug}`).toBe(ids.length)
      })

      it('cabe no limite de 30 itens da rota', () => {
        expect(c.items.length).toBeLessThanOrEqual(30)
      })

      it('todo hábito é uma PERGUNTA de sim ou não', () => {
        // Rótulo seco ("Água") não diz quando marcar; a pergunta dá o critério.
        for (const i of c.items) {
          expect(i.label.trim().length).toBeGreaterThan(0)
          expect(i.label.trim().endsWith('?'), `"${i.label}" não é pergunta`).toBe(true)
        }
      })

      it('nenhum rótulo passa do limite da rota', () => {
        for (const i of c.items) expect(i.label.length).toBeLessThanOrEqual(160)
      })
    })
  }

  it('o completo estende o básico sem perder nenhum hábito', () => {
    const basico = readyMadeChecklist('habitos-basico')!
    const completo = readyMadeChecklist('habitos-completo')!
    const ids = new Set(completo.items.map((i) => i.id))
    for (const i of basico.items) expect(ids.has(i.id)).toBe(true)
    expect(completo.items.length).toBeGreaterThan(basico.items.length)
  })

  it('copiar o catálogo não deixa referência compartilhada', () => {
    // O aplicar na tela faz `items.map(i => ({...i}))`; se o catálogo
    // exportasse os MESMOS objetos entre checklists, editar um paciente
    // contaminaria o outro.
    const basico = readyMadeChecklist('habitos-basico')!
    const completo = readyMadeChecklist('habitos-completo')!
    const compartilhado = basico.items.some((b) => completo.items.some((c) => c === b))
    expect(compartilhado).toBe(false)
  })

  it('resolve por slug e devolve undefined em slug desconhecido', () => {
    expect(readyMadeChecklist('habitos-basico')?.items.length).toBe(5)
    expect(readyMadeChecklist('nao-existe')).toBeUndefined()
  })
})
