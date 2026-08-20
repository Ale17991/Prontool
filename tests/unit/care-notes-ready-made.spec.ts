/**
 * Orientações prontas — o catálogo tem que ser inserível.
 *
 * O texto vai para um paciente ler sozinho, e a rota corta em 5000 caracteres:
 * uma orientação maior seria truncada no meio de uma frase, em produção, sem
 * aviso. Também travamos o tom — este material é apoio, não conduta.
 */
import { describe, expect, it } from 'vitest'
import { READY_MADE_CARE_NOTES, readyMadeCareNote } from '@/lib/core/care-notes/ready-made'

/** Mesmo limite do schema de `POST /api/pacientes/[id]/orientacoes`. */
const MAX_BODY = 5000

describe('catálogo de orientações prontas', () => {
  it('tem orientações e nenhum slug duplicado', () => {
    expect(READY_MADE_CARE_NOTES.length).toBeGreaterThan(0)
    const slugs = READY_MADE_CARE_NOTES.map((n) => n.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  for (const note of READY_MADE_CARE_NOTES) {
    describe(note.title, () => {
      it('cabe no limite da rota — texto truncado é pior que texto ausente', () => {
        expect(note.body.length).toBeGreaterThan(0)
        expect(note.body.length).toBeLessThanOrEqual(MAX_BODY)
      })

      it('tem título e dica de uso', () => {
        expect(note.title.trim().length).toBeGreaterThan(0)
        expect(note.hint.trim().length).toBeGreaterThan(0)
      })

      it('não carrega marcador solto da planilha de origem', () => {
        // A fonte usa "X" para nível sem alimentos; ele não pode vazar para o
        // texto que o paciente lê.
        expect(note.body).not.toMatch(/^\s*X\s*$/m)
        expect(note.body).not.toContain(': .')
        expect(note.body).not.toContain('undefined')
      })

      it('não tem linha vazia com espaço em branco solto', () => {
        expect(note.body).not.toMatch(/[ \t]+$/m)
      })
    })
  }

  it('o guia FODMAP diz que a fase de redução é temporária', () => {
    // Sem isso, o paciente entende "cortar para sempre" — que é justamente o
    // erro que o protocolo FODMAP tenta evitar.
    const g = readyMadeCareNote('fodmap-guia')!
    expect(g.body.toLowerCase()).toContain('reintrodu')
    expect(g.body.toLowerCase()).toContain('não é uma dieta para a vida toda')
  })

  it('o guia FODMAP cobre os grupos alimentares principais', () => {
    const g = readyMadeCareNote('fodmap-guia')!
    for (const grupo of ['FRUTAS', 'LATICÍNIOS', 'CARNES', 'LÍQUIDOS']) {
      expect(g.body).toContain(grupo)
    }
  })

  it('resolve por slug e devolve undefined em slug desconhecido', () => {
    expect(readyMadeCareNote('hidratacao')?.category).toBe('nutricao')
    expect(readyMadeCareNote('nao-existe')).toBeUndefined()
  })
})
