/**
 * Feature 053 — exame solicitado há N dias sem resultado registrado.
 *
 * Compara `exam_requests.issued_at` contra a existência de qualquer
 * `patient_measurements` posterior à emissão. É aproximação deliberada: o
 * pedido lista analitos em JSONB e o resultado vira linha por analito, então
 * casar item a item exigiria normalizar dois vocabulários que hoje não
 * conversam. "Registrou ALGUMA medição depois do pedido" erra para o lado
 * seguro — deixa de cobrar quem trouxe exame parcial, em vez de cobrar quem já
 * trouxe tudo.
 *
 * `requiresPortalActivity: false`: o resultado costuma ser lançado pela
 * clínica, não pelo paciente.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { toDayNumber } from '@/lib/core/habits/period'
import type { EvaluationContext, SignalCandidate } from '../../types'

export async function evaluateExameNaoRealizado(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { days: number }
  if (ctx.patientIds.length === 0) return []

  const supabase = ctx.supabase as SupabaseClient<Database>

  const { data: pedidosRaw, error } = await supabase
    .from('exam_requests')
    .select('id, patient_id, issued_at')
    .eq('tenant_id', ctx.tenantId)
    .in('patient_id', ctx.patientIds)
    .is('deleted_at', null)
    .not('issued_at', 'is', null)
    .order('issued_at', { ascending: false })
  if (error) throw new Error(`exame_nao_realizado: ${error.message}`)

  // Pedido mais recente de cada paciente. Um paciente com três pedidos antigos
  // e um recente não deve ser cobrado pelos antigos.
  const pedido = new Map<string, { id: string; issuedAt: string }>()
  for (const row of (pedidosRaw ?? []) as unknown as Array<{
    id: string
    patient_id: string
    issued_at: string
  }>) {
    if (!pedido.has(row.patient_id)) {
      pedido.set(row.patient_id, { id: row.id, issuedAt: row.issued_at.slice(0, 10) })
    }
  }
  if (pedido.size === 0) return []

  const { data: medRaw, error: errMed } = await supabase
    .from('patient_measurements')
    .select('patient_id, measured_at')
    .eq('tenant_id', ctx.tenantId)
    .in('patient_id', [...pedido.keys()])
    .order('measured_at', { ascending: false })
  if (errMed) throw new Error(`exame_nao_realizado: ${errMed.message}`)

  const ultimaMedicao = new Map<string, string>()
  for (const row of (medRaw ?? []) as unknown as Array<{
    patient_id: string
    measured_at: string
  }>) {
    if (!ultimaMedicao.has(row.patient_id)) {
      ultimaMedicao.set(row.patient_id, row.measured_at.slice(0, 10))
    }
  }

  const hoje = toDayNumber(ctx.cycleDate)
  const out: SignalCandidate[] = []

  for (const [patientId, p] of pedido) {
    const dias = hoje - toDayNumber(p.issuedAt)
    if (dias < params.days) continue

    // Resultado depois da emissão? Então o exame foi feito.
    const ultima = ultimaMedicao.get(patientId)
    if (ultima && toDayNumber(ultima) >= toDayNumber(p.issuedAt)) continue

    out.push({
      patientId,
      observed: { examRequestId: p.id, emitidoEm: p.issuedAt, dias },
      values: { dias: String(dias) },
    })
  }

  return out
}
