/**
 * Helper de teste — popula `appointment_procedures` (multi-procedure) +
 * marca o atendimento como `ativo` via `appointment_completions`.
 *
 * `seedAppointment` (helper geral) só insere em `appointments`; relatorios
 * em `buildFinancialReport` agregam linhas de `appointment_procedures` e
 * filtram por `effective_status='ativo'` (que exige uma row em
 * `appointment_completions`).
 */
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

interface Args {
  tenantId: string
  appointmentId: string
  procedureId: string
  planId: string | null
  priceVersionId: string | null
  amountCents: number
  sequence?: number
}

export async function seedAppointmentLineAndComplete(
  sb: SupabaseClient,
  args: Args,
): Promise<void> {
  const dummyActor = randomUUID()

  // 1) Linha em appointment_procedures (estrutura multi-procedure 0069).
  await sb
    .from('appointment_procedures')
    .insert({
      tenant_id: args.tenantId,
      appointment_id: args.appointmentId,
      procedure_id: args.procedureId,
      plan_id: args.planId,
      source_price_version_id: args.priceVersionId,
      line_amount_cents: args.amountCents,
      vigente_amount_cents: args.amountCents,
      amount_was_overridden: false,
      sequence: args.sequence ?? 1,
      created_by: dummyActor,
    })
    .throwOnError()

  // 2) Completion -> effective_status='ativo' na view.
  await sb
    .from('appointment_completions')
    .insert({
      tenant_id: args.tenantId,
      appointment_id: args.appointmentId,
      completed_by: dummyActor,
      source: 'manual',
      reason: 'seed',
    })
    .throwOnError()
}
