/**
 * Feature 056 — fontes baseadas no acompanhamento clínico do paciente.
 *
 * As três leem o motor de medições da 030 e o plano alimentar da 047, e as três
 * são de ESTADO, não de evento — o que muda o desenho da chave de ocorrência.
 * Um paciente que atingiu a meta continua tendo atingido a meta amanhã; um
 * paciente sem medição há 30 dias segue sem medição no dia 31. Sem chave que
 * segure, cada uma viraria mensagem diária.
 *
 * `meta_atingida` é a exceção feliz: a chave é o id da meta, e uma meta é
 * atingida uma vez. Se a nutricionista lançar meta nova, é outro id e outra
 * comemoração — que é exatamente o comportamento desejado.
 */

import { z } from 'zod'
import { registerSource } from './registry'
import { addDias, dataCivilBr, eligiblePatients, pageAll } from './shared'
import type { EnumerateContext, SourceCandidate } from '../types'

type Resposta = { data: unknown; error: { message: string } | null }

// ---------------------------------------------------------------------------
// Meta de acompanhamento atingida
// ---------------------------------------------------------------------------

registerSource({
  id: 'meta_atingida',
  label: 'Meta de acompanhamento atingida',
  group: 'acompanhamento',
  hint: 'Dispara quando a última medição do paciente alcança a meta lançada para aquela métrica (peso, circunferência, pressão...).',
  paramsSchema: z
    .object({
      metricType: z.string().min(1).max(60).optional(),
    })
    .strict(),
  fields: [
    {
      name: 'metricType',
      label: 'Qual métrica (deixe vazio para qualquer uma)',
      kind: 'select',
      optionsFrom: 'metric_types',
      hint: 'Vazio dispara para qualquer meta atingida — útil quando a clínica quer comemorar tudo com o mesmo texto.',
    },
  ],
  variables: ['metrica', 'valor', 'unidade', 'meta'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { metricType } = ctx.params as { metricType?: string }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const metas = await pageAll<{
      id: string
      patient_id: string
      metric_type: string
      target_value: number
      direction: string
    }>((from, to) => {
      let q = ctx.supabase
        .from('patient_metric_goals')
        .select('id, patient_id, metric_type, target_value, direction')
        .eq('tenant_id', ctx.tenantId)
        .eq('active', true)
      if (metricType) q = q.eq('metric_type', metricType)
      return q.order('id').range(from, to) as unknown as PromiseLike<Resposta>
    }, 'meta_atingida.metas')
    if (metas.length === 0) return []

    // O rótulo da métrica vem do catálogo — global ou da clínica. Sem ele a
    // mensagem diria "seu peso_corporal", que é nome de coluna, não português.
    const tipos = await pageAll<{ metric_type: string; label: string; unit: string }>(
      (from, to) =>
        ctx.supabase
          .from('patient_metric_types')
          .select('metric_type, label, unit')
          .or(`tenant_id.is.null,tenant_id.eq.${ctx.tenantId}`)
          .order('metric_type')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'meta_atingida.tipos',
    )
    const rotulo = new Map(tipos.map((t) => [t.metric_type, t]))

    const out: SourceCandidate[] = []
    for (const meta of metas) {
      if (!aptos.has(meta.patient_id)) continue

      // A ÚLTIMA medição, não a melhor. Quem chegou na meta e voltou atrás não
      // recebe parabéns: seria comemorar um retrato que já não é o presente.
      const { data, error } = await ctx.supabase
        .from('patient_measurements')
        .select('value, unit, measured_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('patient_id', meta.patient_id)
        .eq('metric_type', meta.metric_type)
        .order('measured_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !data) continue

      const m = data as { value: number; unit: string; measured_at: string }
      const atingiu =
        meta.direction === 'decrease' ? m.value <= meta.target_value : m.value >= meta.target_value
      if (!atingiu) continue

      const t = rotulo.get(meta.metric_type)
      out.push({
        patientId: meta.patient_id,
        // Uma meta é atingida uma vez. Meta nova é id novo, e comemorar de novo
        // é o certo.
        occurrenceKey: meta.id,
        variables: {
          metrica: t?.label ?? meta.metric_type,
          valor: formatarNumero(m.value),
          unidade: m.unit || (t?.unit ?? ''),
          meta: formatarNumero(meta.target_value),
        },
      })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Sem medição registrada
// ---------------------------------------------------------------------------

registerSource({
  id: 'sem_medicao',
  label: 'Sem medição registrada há N dias',
  group: 'acompanhamento',
  hint: 'Dispara para quem já registrou alguma medição antes e está há N dias sem nenhuma nova. Repete no máximo uma vez por mês.',
  /**
   * A ausência de medição pode ser do PACIENTE (não pesou) ou da CLÍNICA (pesou
   * e ninguém lançou). O sistema não distingue, e a mensagem não pode acusar —
   * mesma família de cuidado do FR-009 no checklist.
   */
  warning:
    'O sistema sabe que NENHUMA medição foi registrada — não se o paciente deixou de se medir ou se a clínica deixou de lançar. Escreva como convite ("que tal atualizar seus números?"), nunca como cobrança.',
  paramsSchema: z.object({ dias: z.number().int().min(7).max(365) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Dias sem nenhuma medição',
      kind: 'number',
      min: 7,
      max: 365,
      defaultValue: 30,
      hint: 'Mínimo de 7 dias: abaixo disso a mensagem chega antes de o acompanhamento fazer sentido.',
    },
  ],
  variables: ['dias', 'ultima_medicao'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { dias } = ctx.params as { dias: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    // Uma varredura só, e a decisão é por paciente em memória. Consultar "a
    // última medição de cada um" paciente a paciente seria uma ida ao banco por
    // pessoa da clínica inteira, todo dia.
    const medicoes = await pageAll<{ patient_id: string; measured_at: string }>(
      (from, to) =>
        ctx.supabase
          .from('patient_measurements')
          .select('patient_id, measured_at')
          .eq('tenant_id', ctx.tenantId)
          .order('patient_id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'sem_medicao',
    )

    const ultima = new Map<string, string>()
    for (const m of medicoes) {
      const atual = ultima.get(m.patient_id)
      if (!atual || m.measured_at > atual) ultima.set(m.patient_id, m.measured_at)
    }

    const corte = addDias(ctx.today, -dias)
    const out: SourceCandidate[] = []
    for (const [patientId, quando] of ultima) {
      if (!aptos.has(patientId)) continue
      // `quando` é TIMESTAMPTZ; comparar com o dia civil da clínica pelo prefixo
      // é suficiente aqui porque o corte é de dezenas de dias — um erro de
      // fuso de três horas não muda de lado uma linha de 30 dias atrás.
      if (quando.slice(0, 10) > corte) continue

      // Quem NUNCA mediu não entra: a fonte é sobre acompanhamento
      // interrompido, e o `ultima` só tem quem já mediu ao menos uma vez.
      out.push({
        patientId,
        // Chave MENSAL, como `sem_retorno`: estado contínuo precisa de freio
        // próprio, senão vira mensagem diária até a pessoa se pesar.
        occurrenceKey: ctx.today.slice(0, 7),
        variables: { dias: String(dias), ultima_medicao: dataCivilBr(quando.slice(0, 10)) },
      })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Plano alimentar pedindo revisão
// ---------------------------------------------------------------------------

registerSource({
  id: 'plano_alimentar_revisao',
  label: 'Plano alimentar ativo há N dias',
  group: 'acompanhamento',
  requiresModule: 'dieta',
  hint: 'Dispara quando o plano alimentar ativo do paciente completa N dias, para convidar à revisão.',
  paramsSchema: z.object({ dias: z.number().int().min(7).max(365) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Dias desde a prescrição',
      kind: 'number',
      min: 7,
      max: 365,
      defaultValue: 30,
    },
  ],
  variables: ['plano', 'dias', 'desde'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { dias } = ctx.params as { dias: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const alvo = addDias(ctx.today, -dias)

    const planos = await pageAll<{
      id: string
      patient_id: string
      title: string
      created_at: string
      status: string
    }>(
      (from, to) =>
        ctx.supabase
          .from('diet_plans')
          .select('id, patient_id, title, created_at, status')
          .eq('tenant_id', ctx.tenantId)
          .eq('active', true)
          .gte('created_at', `${alvo}T00:00:00.000Z`)
          .lt('created_at', `${addDias(alvo, 1)}T00:00:00.000Z`)
          .order('id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'plano_alimentar_revisao',
    )

    return planos
      .filter((p) => aptos.has(p.patient_id))
      .map((p) => ({
        patientId: p.patient_id,
        // Um convite por PLANO. Plano novo (a revisão que este convite pediu) é
        // id novo, e volta a contar do zero.
        occurrenceKey: p.id,
        variables: {
          plano: p.title,
          dias: String(dias),
          desde: dataCivilBr(p.created_at.slice(0, 10)),
        },
      }))
  },
})

/** Sem casas decimais inúteis: 72 é "72", 71,5 continua "71,5". */
function formatarNumero(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}
