/**
 * T073 (Feature 053) — os predicados das sete famílias de ausência restantes.
 *
 * Duas coisas concentram o risco aqui, e as duas geram mensagem errada sem
 * erro nenhum no log:
 *
 *   1. `sem_retorno` precisa das DUAS condições. Cobrar "faz 8 meses que você
 *      não vem" de quem tem consulta marcada para semana que vem é a mensagem
 *      que mais rápido faz a clínica desligar a feature.
 *
 *   2. Paciente que NUNCA registrou não pode ser cobrado por ter parado.
 *      Nunca ter começado e ter desistido são coisas diferentes.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { mesesEntre } from '@/lib/core/signals/families/ausencia/_ultimo-registro'
import { evaluateSemRegistrarMedicao } from '@/lib/core/signals/families/ausencia/sem-registrar-medicao'
import { evaluateAvaliacaoVencida } from '@/lib/core/signals/families/ausencia/avaliacao-vencida'
import { evaluateSemRetorno } from '@/lib/core/signals/families/ausencia/sem-retorno'
import { evaluateAfastandoDaMeta } from '@/lib/core/signals/families/ausencia/afastando-da-meta'
import { evaluateExameNaoRealizado } from '@/lib/core/signals/families/ausencia/exame-nao-realizado'

const TENANT = '11111111-1111-1111-1111-111111111111'
const P = '22222222-2222-2222-2222-222222222222'
const HOJE = '2026-08-20'

function fake(tabelas: Record<string, unknown[]>): SupabaseClient<Database> {
  return {
    from(tabela: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        not: () => chain,
        gte: () => chain,
        lt: () => chain,
        lte: () => chain,
        order: () => chain,
        then: (resolve: (r: unknown) => void) =>
          Promise.resolve({ data: tabelas[tabela] ?? [], error: null }).then(resolve),
      }
      return chain
    },
  } as unknown as SupabaseClient<Database>
}

const ctx = (supabase: SupabaseClient<Database>, params: Record<string, unknown>) => ({
  supabase,
  tenantId: TENANT,
  params,
  patientIds: [P],
  cycleDate: HOJE,
  timezone: 'America/Sao_Paulo',
})

describe('mesesEntre — calendário, não "30 dias"', () => {
  it('conta meses completos', () => {
    expect(mesesEntre('2026-02-20', '2026-08-20')).toBe(6)
    expect(mesesEntre('2026-02-20', '2026-08-19')).toBe(5)
    expect(mesesEntre('2025-08-20', '2026-08-20')).toBe(12)
  })

  it('não escorrega quando o dia de origem é alto', () => {
    // Somar 30 dias fixos iria deslocando mês a mês até a mensagem cair na
    // semana errada.
    expect(mesesEntre('2026-01-31', '2026-03-01')).toBe(1)
  })
})

describe('sem_registrar_medicao', () => {
  it('dispara quando a última medição é mais antiga que o limite', async () => {
    const r = await evaluateSemRegistrarMedicao(
      ctx(
        fake({
          patient_measurements: [{ patient_id: P, measured_at: '2026-08-01' }],
        }),
        { metricType: 'peso', days: 14 },
      ),
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.values.metrica).toBe('peso')
    expect(r[0]!.values.dias).toBe('19')
  })

  it('não dispara com medição recente', async () => {
    const r = await evaluateSemRegistrarMedicao(
      ctx(fake({ patient_measurements: [{ patient_id: P, measured_at: '2026-08-18' }] }), {
        metricType: 'peso',
        days: 14,
      }),
    )
    expect(r).toHaveLength(0)
  })

  /**
   * Nunca ter registrado é diferente de ter parado de registrar. O primeiro é
   * alguém a quem a clínica ainda não pediu nada; cobrá-lo é mandar cobrança
   * sobre um combinado que nunca existiu.
   */
  it('paciente sem NENHUMA medição não é cobrado', async () => {
    const r = await evaluateSemRegistrarMedicao(ctx(fake({ patient_measurements: [] }), {
      metricType: 'peso',
      days: 14,
    }))
    expect(r).toHaveLength(0)
  })

  it('métrica em snake_case sai legível no texto', async () => {
    const r = await evaluateSemRegistrarMedicao(
      ctx(fake({ patient_measurements: [{ patient_id: P, measured_at: '2026-01-01' }] }), {
        metricType: 'circunferencia_abdominal',
        days: 30,
      }),
    )
    expect(r[0]!.values.metrica).toBe('circunferencia abdominal')
  })
})

describe('avaliacao_vencida — limite em meses', () => {
  it('dispara passado o número de meses', async () => {
    const r = await evaluateAvaliacaoVencida(
      ctx(fake({ nutrition_assessments: [{ patient_id: P, assessed_at: '2026-02-10' }] }), {
        months: 6,
      }),
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.values.meses).toBe('6')
  })

  it('não dispara antes', async () => {
    const r = await evaluateAvaliacaoVencida(
      ctx(fake({ nutrition_assessments: [{ patient_id: P, assessed_at: '2026-05-10' }] }), {
        months: 6,
      }),
    )
    expect(r).toHaveLength(0)
  })
})

describe('sem_retorno — as DUAS condições', () => {
  it('dispara sem consulta há N meses e sem futura marcada', async () => {
    const r = await evaluateSemRetorno(
      ctx(
        fake({
          appointments: [{ patient_id: P, appointment_at: '2026-01-10T10:00:00.000Z' }],
        }),
        { months: 6 },
      ),
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.values.meses).toBe('7')
  })

  /**
   * O erro mais fácil de cometer, porque a primeira condição sozinha parece
   * suficiente — e o resultado é constranger a clínica na frente do paciente.
   */
  it('NÃO dispara quando já existe consulta futura marcada', async () => {
    const r = await evaluateSemRetorno(
      ctx(
        fake({
          appointments: [
            { patient_id: P, appointment_at: '2026-09-01T10:00:00.000Z' },
            { patient_id: P, appointment_at: '2026-01-10T10:00:00.000Z' },
          ],
        }),
        { months: 6 },
      ),
    )
    expect(r).toHaveLength(0)
  })

  it('não dispara com consulta recente', async () => {
    const r = await evaluateSemRetorno(
      ctx(fake({ appointments: [{ patient_id: P, appointment_at: '2026-07-10T10:00:00.000Z' }] }), {
        months: 6,
      }),
    )
    expect(r).toHaveLength(0)
  })

  it('paciente sem nenhuma consulta não entra', async () => {
    expect(await evaluateSemRetorno(ctx(fake({ appointments: [] }), { months: 6 }))).toHaveLength(0)
  })
})

describe('afastando_da_meta', () => {
  const meta = { patient_id: P, metric_type: 'peso', direction: 'decrease', target_value: 70 }

  it('dispara com N medições consecutivas subindo numa meta de redução', async () => {
    const r = await evaluateAfastandoDaMeta(
      ctx(
        fake({
          patient_metric_goals: [meta],
          patient_measurements: [
            { patient_id: P, value: 78, measured_at: '2026-08-18' },
            { patient_id: P, value: 76, measured_at: '2026-08-11' },
            { patient_id: P, value: 74, measured_at: '2026-08-04' },
          ],
        }),
        { metricType: 'peso', consecutive: 2 },
      ),
    )
    expect(r).toHaveLength(1)
  })

  it('não dispara se uma das transições melhorou', async () => {
    const r = await evaluateAfastandoDaMeta(
      ctx(
        fake({
          patient_metric_goals: [meta],
          patient_measurements: [
            { patient_id: P, value: 78, measured_at: '2026-08-18' },
            { patient_id: P, value: 79, measured_at: '2026-08-11' },
            { patient_id: P, value: 74, measured_at: '2026-08-04' },
          ],
        }),
        { metricType: 'peso', consecutive: 2 },
      ),
    )
    expect(r).toHaveLength(0)
  })

  /** Quem já chegou na meta não está se afastando dela, mesmo oscilando. */
  it('não dispara para quem já está dentro da meta', async () => {
    const r = await evaluateAfastandoDaMeta(
      ctx(
        fake({
          patient_metric_goals: [meta],
          patient_measurements: [
            { patient_id: P, value: 69, measured_at: '2026-08-18' },
            { patient_id: P, value: 68, measured_at: '2026-08-11' },
            { patient_id: P, value: 67, measured_at: '2026-08-04' },
          ],
        }),
        { metricType: 'peso', consecutive: 2 },
      ),
    )
    expect(r).toHaveLength(0)
  })

  it('não dispara com medições insuficientes', async () => {
    const r = await evaluateAfastandoDaMeta(
      ctx(
        fake({
          patient_metric_goals: [meta],
          patient_measurements: [{ patient_id: P, value: 78, measured_at: '2026-08-18' }],
        }),
        { metricType: 'peso', consecutive: 2 },
      ),
    )
    expect(r).toHaveLength(0)
  })

  it('nunca expõe valor numérico nos placeholders', async () => {
    const r = await evaluateAfastandoDaMeta(
      ctx(
        fake({
          patient_metric_goals: [meta],
          patient_measurements: [
            { patient_id: P, value: 78, measured_at: '2026-08-18' },
            { patient_id: P, value: 76, measured_at: '2026-08-11' },
            { patient_id: P, value: 74, measured_at: '2026-08-04' },
          ],
        }),
        { metricType: 'peso', consecutive: 2 },
      ),
    )
    expect(Object.keys(r[0]!.values)).toEqual(['metrica'])
  })
})

describe('exame_nao_realizado', () => {
  it('dispara com pedido antigo e nenhum resultado depois', async () => {
    const r = await evaluateExameNaoRealizado(
      ctx(
        fake({
          exam_requests: [{ id: 'e1', patient_id: P, issued_at: '2026-08-01T10:00:00.000Z' }],
          patient_measurements: [],
        }),
        { days: 10 },
      ),
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.values.dias).toBe('19')
  })

  it('não dispara quando houve medição depois da emissão', async () => {
    const r = await evaluateExameNaoRealizado(
      ctx(
        fake({
          exam_requests: [{ id: 'e1', patient_id: P, issued_at: '2026-08-01T10:00:00.000Z' }],
          patient_measurements: [{ patient_id: P, measured_at: '2026-08-05' }],
        }),
        { days: 10 },
      ),
    )
    expect(r).toHaveLength(0)
  })

  it('medição ANTERIOR ao pedido não conta como resultado', async () => {
    const r = await evaluateExameNaoRealizado(
      ctx(
        fake({
          exam_requests: [{ id: 'e1', patient_id: P, issued_at: '2026-08-01T10:00:00.000Z' }],
          patient_measurements: [{ patient_id: P, measured_at: '2026-07-10' }],
        }),
        { days: 10 },
      ),
    )
    expect(r).toHaveLength(1)
  })

  it('pedido recente não dispara', async () => {
    const r = await evaluateExameNaoRealizado(
      ctx(
        fake({
          exam_requests: [{ id: 'e1', patient_id: P, issued_at: '2026-08-18T10:00:00.000Z' }],
          patient_measurements: [],
        }),
        { days: 10 },
      ),
    )
    expect(r).toHaveLength(0)
  })
})
