/**
 * Feature 053 — acolhimento alguns dias depois da consulta.
 *
 * Dispara no dia EXATO (`days` dias após a consulta), não a partir dele: com
 * `>=`, todo paciente que já consultou entraria todo dia para sempre, e só a
 * janela de silêncio seguraria — mal.
 *
 * Consulta estornada não conta. Do ponto de vista do paciente ela não
 * aconteceu, e perguntar "como você está depois da consulta?" para quem teve o
 * atendimento cancelado é a mensagem mais estranha que a clínica pode mandar.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { addDays } from '@/lib/core/habits/period'
import type { EvaluationContext, SignalCandidate } from '../../types'

export async function evaluatePosConsulta(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { days: number }
  if (ctx.patientIds.length === 0) return []

  const supabase = ctx.supabase as SupabaseClient<Database>

  const alvo = addDays(ctx.cycleDate, -params.days)
  const inicio = `${alvo}T00:00:00.000Z`
  const fim = `${addDays(alvo, 1)}T00:00:00.000Z`

  const { data, error } = await supabase
    .from('appointments')
    .select('id, patient_id, appointment_at')
    .eq('tenant_id', ctx.tenantId)
    .in('patient_id', ctx.patientIds)
    .gte('appointment_at', inicio)
    .lt('appointment_at', fim)
  if (error) throw new Error(`pos_consulta: ${error.message}`)

  const consultas = (data ?? []) as unknown as Array<{
    id: string
    patient_id: string
    appointment_at: string
  }>
  if (consultas.length === 0) return []

  const estornadas = await idsEstornados(supabase, ctx.tenantId, consultas.map((c) => c.id))

  const vistos = new Set<string>()
  const out: SignalCandidate[] = []

  for (const c of consultas) {
    if (estornadas.has(c.id)) continue
    // Duas consultas no mesmo dia geram uma mensagem, não duas.
    if (vistos.has(c.patient_id)) continue
    vistos.add(c.patient_id)

    out.push({
      patientId: c.patient_id,
      observed: { appointmentId: c.id, consultaEm: c.appointment_at, diasDepois: params.days },
      values: { dias: String(params.days) },
    })
  }

  return out
}

async function idsEstornados(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentIds: string[],
): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from('appointment_reversals')
    .select('appointment_id')
    .eq('tenant_id', tenantId)
    .in('appointment_id', appointmentIds)
  if (error) throw new Error(`pos_consulta: ${error.message}`)
  return new Set(
    (data ?? []).map((r) => (r as { appointment_id: string }).appointment_id),
  )
}
