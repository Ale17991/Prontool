/**
 * T059 (Feature 053) — as cinco famílias de celebração.
 *
 * O erro típico destas famílias não é deixar de disparar: é disparar TODO DIA
 * depois do evento. Parabéns repetidos por dez dias seguidos transformam
 * reconhecimento em ruído, e o paciente passa a ignorar tudo que vem da
 * clínica — inclusive o lembrete de consulta. Por isso quase todo caso aqui
 * testa a VIRADA, e não a condição.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { evaluateMetaAtingida } from '@/lib/core/signals/families/celebracao/meta-atingida'
import { evaluateSequenciaHabito } from '@/lib/core/signals/families/celebracao/sequencia-habito'
import { evaluateAniversarioAcompanhamento } from '@/lib/core/signals/families/celebracao/aniversario-acompanhamento'
import { evaluatePosConsulta } from '@/lib/core/signals/families/celebracao/pos-consulta'

const TENANT = '11111111-1111-1111-1111-111111111111'
const PACIENTE = '22222222-2222-2222-2222-222222222222'
const HOJE = '2026-08-20'

/** Client falso: devolve por tabela, respeitando os filtros que importam. */
function fake(tabelas: Record<string, unknown[]>): SupabaseClient<Database> {
  return {
    from(tabela: string) {
      const estado: { desde?: string; ate?: string } = {}
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        lte: () => chain,
        gte: (_c: string, v: string) => {
          estado.desde = v
          return chain
        },
        lt: (_c: string, v: string) => {
          estado.ate = v
          return chain
        },
        order: () => chain,
        then: (resolve: (r: unknown) => void) => {
          let linhas = (tabelas[tabela] ?? []) as Array<Record<string, string>>
          if (estado.desde) {
            const campo = 'appointment_at' in (linhas[0] ?? {}) ? 'appointment_at' : 'mark_date'
            linhas = linhas.filter((l) => (l[campo] ?? '') >= (estado.desde as string))
          }
          if (estado.ate) {
            linhas = linhas.filter((l) => (l.appointment_at ?? '') < (estado.ate as string))
          }
          return Promise.resolve({ data: linhas, error: null }).then(resolve)
        },
      }
      return chain
    },
  } as unknown as SupabaseClient<Database>
}

const ctx = (supabase: SupabaseClient<Database>, params: Record<string, unknown>) => ({
  supabase,
  tenantId: TENANT,
  params,
  patientIds: [PACIENTE],
  cycleDate: HOJE,
  timezone: 'America/Sao_Paulo',
})

// ---------------------------------------------------------------------------

describe('meta_atingida — dispara na virada', () => {
  const meta = {
    patient_id: PACIENTE,
    metric_type: 'peso',
    direction: 'decrease',
    target_value: 70,
  }

  it('dispara quando a atual alcança e a anterior não alcançava', async () => {
    const r = await evaluateMetaAtingida(
      ctx(
        fake({
          patient_metric_goals: [meta],
          patient_measurements: [
            { patient_id: PACIENTE, value: 69.5, measured_at: '2026-08-19' },
            { patient_id: PACIENTE, value: 71, measured_at: '2026-08-05' },
          ],
        }),
        { metricType: 'peso' },
      ),
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.values.metrica).toBe('peso')
  })

  it('NÃO dispara quando as duas já alcançavam — senão parabeniza todo dia', async () => {
    const r = await evaluateMetaAtingida(
      ctx(
        fake({
          patient_metric_goals: [meta],
          patient_measurements: [
            { patient_id: PACIENTE, value: 69, measured_at: '2026-08-19' },
            { patient_id: PACIENTE, value: 69.5, measured_at: '2026-08-05' },
          ],
        }),
        { metricType: 'peso' },
      ),
    )
    expect(r).toHaveLength(0)
  })

  it('NÃO dispara quando a atual ainda não alcançou', async () => {
    const r = await evaluateMetaAtingida(
      ctx(
        fake({
          patient_metric_goals: [meta],
          patient_measurements: [
            { patient_id: PACIENTE, value: 72, measured_at: '2026-08-19' },
            { patient_id: PACIENTE, value: 75, measured_at: '2026-08-05' },
          ],
        }),
        { metricType: 'peso' },
      ),
    )
    expect(r).toHaveLength(0)
  })

  /**
   * Uma medição só não é virada: pode ser o primeiro registro de quem já estava
   * na meta antes de começar. Parabenizar aí é a clínica se creditar de algo
   * que não fez.
   */
  it('NÃO dispara com uma única medição', async () => {
    const r = await evaluateMetaAtingida(
      ctx(
        fake({
          patient_metric_goals: [meta],
          patient_measurements: [{ patient_id: PACIENTE, value: 65, measured_at: '2026-08-19' }],
        }),
        { metricType: 'peso' },
      ),
    )
    expect(r).toHaveLength(0)
  })

  it('meta de aumento usa a comparação inversa', async () => {
    const r = await evaluateMetaAtingida(
      ctx(
        fake({
          patient_metric_goals: [{ ...meta, direction: 'increase', target_value: 60 }],
          patient_measurements: [
            { patient_id: PACIENTE, value: 61, measured_at: '2026-08-19' },
            { patient_id: PACIENTE, value: 58, measured_at: '2026-08-05' },
          ],
        }),
        { metricType: 'peso' },
      ),
    )
    expect(r).toHaveLength(1)
  })

  it('sem meta ativa não dispara', async () => {
    const r = await evaluateMetaAtingida(
      ctx(fake({ patient_metric_goals: [], patient_measurements: [] }), { metricType: 'peso' }),
    )
    expect(r).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe('sequencia_habito', () => {
  const grade = {
    id: 'g1',
    patient_id: PACIENTE,
    start_date: '2026-07-01',
    items: [{ id: 'agua', label: 'Água 2L' }],
  }
  const marca = (d: string) => ({ checklist_id: 'g1', item_id: 'agua', mark_date: d })

  it('dispara ao alcançar a sequência alvo', async () => {
    const r = await evaluateSequenciaHabito(
      ctx(
        fake({
          patient_habit_checklists: [grade],
          habit_checklist_marks: ['2026-08-20', '2026-08-19', '2026-08-18'].map(marca),
        }),
        { days: 3, itemId: 'agua' },
      ),
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.values.habito).toBe('Água 2L')
  })

  it('não dispara com sequência menor que o alvo', async () => {
    const r = await evaluateSequenciaHabito(
      ctx(
        fake({
          patient_habit_checklists: [grade],
          habit_checklist_marks: ['2026-08-20', '2026-08-19'].map(marca),
        }),
        { days: 3, itemId: 'agua' },
      ),
    )
    expect(r).toHaveLength(0)
  })

  /**
   * A sequência não pode zerar toda manhã: o dia ainda não acabou. Punir a
   * pessoa por acordar é o jeito mais rápido de ela desistir da grade.
   */
  it('conta a partir de ontem quando hoje ainda não foi marcado', async () => {
    const r = await evaluateSequenciaHabito(
      ctx(
        fake({
          patient_habit_checklists: [grade],
          habit_checklist_marks: ['2026-08-19', '2026-08-18', '2026-08-17'].map(marca),
        }),
        { days: 3, itemId: 'agua' },
      ),
    )
    expect(r).toHaveLength(1)
  })

  it('sequência interrompida no meio não conta', async () => {
    const r = await evaluateSequenciaHabito(
      ctx(
        fake({
          patient_habit_checklists: [grade],
          habit_checklist_marks: ['2026-08-20', '2026-08-19', '2026-08-17'].map(marca),
        }),
        { days: 3, itemId: 'agua' },
      ),
    )
    expect(r).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe('aniversario_acompanhamento', () => {
  const consulta = (d: string) => ({ patient_id: PACIENTE, appointment_at: `${d}T10:00:00.000Z` })

  it('dispara no dia do mês em que começou, em múltiplo do parâmetro', async () => {
    // Começou 20/02/2026, hoje 20/08/2026 = 6 meses.
    const r = await evaluateAniversarioAcompanhamento(
      ctx(fake({ appointments: [consulta('2026-02-20')] }), { months: 6 }),
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.values.meses).toBe('6')
  })

  it('não dispara em mês que não é múltiplo', async () => {
    // 5 meses, parâmetro 6.
    const r = await evaluateAniversarioAcompanhamento(
      ctx(fake({ appointments: [consulta('2026-03-20')] }), { months: 6 }),
    )
    expect(r).toHaveLength(0)
  })

  it('não dispara em dia diferente do dia de início', async () => {
    const r = await evaluateAniversarioAcompanhamento(
      ctx(fake({ appointments: [consulta('2026-02-15')] }), { months: 6 }),
    )
    expect(r).toHaveLength(0)
  })

  it('dispara em 12 meses com parâmetro 6 — é múltiplo', async () => {
    const r = await evaluateAniversarioAcompanhamento(
      ctx(fake({ appointments: [consulta('2025-08-20')] }), { months: 6 }),
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.values.meses).toBe('12')
  })

  it('não dispara no dia zero', async () => {
    const r = await evaluateAniversarioAcompanhamento(
      ctx(fake({ appointments: [consulta('2026-08-20')] }), { months: 1 }),
    )
    expect(r).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe('pos_consulta', () => {
  it('dispara no dia exato', async () => {
    const r = await evaluatePosConsulta(
      ctx(
        fake({
          appointments: [
            { id: 'a1', patient_id: PACIENTE, appointment_at: '2026-08-17T14:00:00.000Z' },
          ],
          appointment_reversals: [],
        }),
        { days: 3 },
      ),
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.values.dias).toBe('3')
  })

  /**
   * Do ponto de vista do paciente a consulta estornada não aconteceu.
   * Perguntar "como você está depois da consulta?" para quem teve o atendimento
   * cancelado é a mensagem mais estranha que a clínica pode mandar.
   */
  it('consulta estornada não gera mensagem', async () => {
    const r = await evaluatePosConsulta(
      ctx(
        fake({
          appointments: [
            { id: 'a1', patient_id: PACIENTE, appointment_at: '2026-08-17T14:00:00.000Z' },
          ],
          appointment_reversals: [{ appointment_id: 'a1' }],
        }),
        { days: 3 },
      ),
    )
    expect(r).toHaveLength(0)
  })

  it('duas consultas no mesmo dia geram uma mensagem só', async () => {
    const r = await evaluatePosConsulta(
      ctx(
        fake({
          appointments: [
            { id: 'a1', patient_id: PACIENTE, appointment_at: '2026-08-17T09:00:00.000Z' },
            { id: 'a2', patient_id: PACIENTE, appointment_at: '2026-08-17T16:00:00.000Z' },
          ],
          appointment_reversals: [],
        }),
        { days: 3 },
      ),
    )
    expect(r).toHaveLength(1)
  })

  it('nada fora da janela do dia alvo', async () => {
    const r = await evaluatePosConsulta(
      ctx(
        fake({
          appointments: [
            { id: 'a1', patient_id: PACIENTE, appointment_at: '2026-08-16T14:00:00.000Z' },
          ],
          appointment_reversals: [],
        }),
        { days: 3 },
      ),
    )
    expect(r).toHaveLength(0)
  })
})
