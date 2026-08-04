/**
 * T015 (Feature 053) — invariantes do catálogo de famílias.
 *
 * O que está sob teste não é comportamento: é o CONTRATO que impede o desenho
 * de escorregar. Cada invariante aqui corresponde a um jeito conhecido de a
 * feature causar dano — e nenhum deles falha ruidosamente em produção. Uma
 * família de ausência marcada como celebração passaria a cobrar sem filtro de
 * portal, e ninguém perceberia até um paciente reclamar.
 */
import { describe, expect, it } from 'vitest'
import { CATALOG, familyById, familiesByNature } from '@/lib/core/signals/catalog'
import { hasForbiddenPhrase, FORBIDDEN_COUNT } from '@/lib/core/signals/forbidden-phrases'
import { extractPlaceholders } from '@/lib/core/signals/template'

describe('catálogo de famílias — invariantes', () => {
  it('tem as 14 famílias, 5 de celebração e 9 de ausência', () => {
    expect(CATALOG).toHaveLength(14)
    expect(familiesByNature('celebracao')).toHaveLength(5)
    expect(familiesByNature('ausencia')).toHaveLength(9)
  })

  it('INV-3: priority é única — empate reintroduziria não-determinismo no teto', () => {
    const p = CATALOG.map((f) => f.priority)
    expect(new Set(p).size).toBe(p.length)
  })

  /**
   * A faixa de prioridade É o mecanismo de FR-002b. Não há código que diga
   * "celebração ganha"; o desempate por prioridade entrega isso sozinho —
   * desde que as faixas não se cruzem.
   */
  it('INV-6: celebração ocupa 1–9 e ausência 10+', () => {
    for (const f of CATALOG) {
      if (f.nature === 'celebracao') expect(f.priority).toBeLessThan(10)
      else expect(f.priority).toBeGreaterThanOrEqual(10)
    }
  })

  it('INV-7: nenhuma família de celebração exige atividade no portal', () => {
    for (const f of familiesByNature('celebracao')) {
      expect(f.requiresPortalActivity).toBe(false)
    }
  })

  /**
   * O filtro de portal existe porque ausência de registro é ambígua. Toda
   * família que observa registro FEITO PELO PACIENTE precisa dele; marcá-la
   * como `false` reabre a cobrança de quem talvez esteja cumprindo o hábito e
   * só não registrou.
   */
  it('INV-4: famílias que observam registro do paciente exigem atividade no portal', () => {
    const observamRegistroDoPaciente = [
      'habito_sem_registro',
      'sem_registrar_medicao',
      'recordatorio_em_branco',
    ]
    for (const id of observamRegistroDoPaciente) {
      expect(familyById(id)?.requiresPortalActivity).toBe(true)
    }
  })

  it('sem_acesso_portal NÃO exige atividade no portal — é ela que observa o sumiço', () => {
    expect(familyById('sem_acesso_portal')?.requiresPortalActivity).toBe(false)
  })

  it('INV-1: todo texto padrão de AUSÊNCIA passa na lista de expressões proibidas', () => {
    for (const f of familiesByNature('ausencia')) {
      expect(
        hasForbiddenPhrase(f.defaultTemplate),
        `${f.id} tem frase acusatória no texto padrão`,
      ).toBe(false)
    }
  })

  it('INV-2: todo texto padrão só usa placeholders declarados pela própria família', () => {
    for (const f of CATALOG) {
      const usados = extractPlaceholders(f.defaultTemplate)
      const desconhecidos = usados.filter((p) => !f.placeholders.includes(p))
      expect(desconhecidos, `${f.id} usa placeholder não declarado`).toEqual([])
    }
  })

  /**
   * INV-5, nos dois sentidos. "Seu peso caiu 4 kg" parece inofensivo, mas é o
   * mesmo dado clínico sem interlocutor — e estabelece que o número é o
   * assunto, o que torna a mensagem seguinte, quando ele subir, muito pior.
   */
  it('INV-5: nenhuma família de meta oferece placeholder de valor numérico', () => {
    const proibidos = ['valor', 'peso', 'delta', 'variacao', 'diferenca', 'resultado', 'numero']
    for (const id of ['meta_atingida', 'afastando_da_meta']) {
      const f = familyById(id)!
      for (const p of proibidos) {
        expect(f.placeholders, `${id} não pode oferecer "${p}"`).not.toContain(p)
      }
    }
  })

  it('todo texto padrão cita o paciente e a clínica', () => {
    for (const f of CATALOG) {
      const usados = extractPlaceholders(f.defaultTemplate)
      expect(usados, `${f.id} deveria citar o paciente`).toContain('paciente')
      expect(usados, `${f.id} deveria citar a clínica`).toContain('clinica')
    }
  })

  it('toda família tem silêncio padrão plausível e schema de params', () => {
    for (const f of CATALOG) {
      expect(f.defaultSilenceDays).toBeGreaterThanOrEqual(1)
      expect(f.defaultSilenceDays).toBeLessThanOrEqual(365)
      expect(f.paramsSchema).toBeDefined()
      expect(f.label.length).toBeGreaterThan(0)
    }
  })

  it('familyById devolve null para id desconhecido, em vez de estourar', () => {
    expect(familyById('nao_existe')).toBeNull()
  })

  it('a lista de expressões proibidas não esvaziou', () => {
    expect(FORBIDDEN_COUNT).toBeGreaterThanOrEqual(10)
  })
})

describe('paramsSchema — validação por família', () => {
  it('habito_sem_registro aceita days no intervalo e recusa fora', () => {
    const s = familyById('habito_sem_registro')!.paramsSchema
    expect(s.safeParse({ days: 3 }).success).toBe(true)
    expect(s.safeParse({ days: 3, itemId: 'agua' }).success).toBe(true)
    expect(s.safeParse({ days: 1 }).success).toBe(false)
    expect(s.safeParse({ days: 999 }).success).toBe(false)
    expect(s.safeParse({}).success).toBe(false)
  })

  it('aniversario não exige parâmetro nenhum', () => {
    expect(familyById('aniversario')!.paramsSchema.safeParse({}).success).toBe(true)
  })

  it('afastando_da_meta exige métrica e número de medições consecutivas', () => {
    const s = familyById('afastando_da_meta')!.paramsSchema
    expect(s.safeParse({ metricType: 'peso', consecutive: 2 }).success).toBe(true)
    expect(s.safeParse({ consecutive: 2 }).success).toBe(false)
  })
})
