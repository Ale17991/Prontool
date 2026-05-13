import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Linha de procedimento de um atendimento (feature multi-procedimento).
 * Append-only via trigger. Cada linha tem seu proprio plano, valor
 * congelado e source_price_version_id.
 */
export interface AppointmentProcedureLine {
  id: string
  procedureId: string
  procedureTussCode: string | null
  procedureDisplayName: string | null
  planId: string | null
  planName: string | null
  sourcePriceVersionId: string | null
  /** Valor UNITARIO em cents. Total da linha = lineAmountCents * quantity. */
  lineAmountCents: number
  vigenteAmountCents: number
  amountWasOverridden: boolean
  sequence: number
  /** Multiplicador (>=1, default 1). Migration 0081. */
  quantity: number
  createdAt: string
  createdBy: string
}

export interface ListAppointmentProceduresInput {
  appointmentId: string
  /**
   * Tenant da sessao. OBRIGATORIO mesmo com RLS — service-role bypassa RLS,
   * o filtro explicito impede vazamento cross-tenant.
   */
  tenantId: string
}

export async function listAppointmentProcedures(
  supabase: SupabaseClient<Database>,
  input: ListAppointmentProceduresInput,
): Promise<AppointmentProcedureLine[]> {
  const { data, error } = await supabase
    .from('appointment_procedures' as never)
    .select(
      'id, procedure_id, plan_id, source_price_version_id, line_amount_cents, vigente_amount_cents, amount_was_overridden, sequence, quantity, created_at, created_by, ' +
        'procedures:procedure_id(tuss_code, display_name), health_plans:plan_id(name)',
    )
    .eq('appointment_id', input.appointmentId)
    .eq('tenant_id', input.tenantId)
    .order('sequence', { ascending: true })

  if (error) {
    // Em ambientes onde a migration 0069 ainda nao aplicou, devolvemos
    // lista vazia — o card simplesmente nao renderiza.
    if (/relation .*appointment_procedures.* does not exist/i.test(error.message)) {
      return []
    }
    throw new Error(`listAppointmentProcedures failed: ${error.message}`)
  }

  return (data ?? []).map((r: Record<string, unknown>) => {
    const proc = r.procedures as { tuss_code: string | null; display_name: string | null } | null
    const plan = r.health_plans as { name: string | null } | null
    return {
      id: r.id as string,
      procedureId: r.procedure_id as string,
      procedureTussCode: proc?.tuss_code ?? null,
      procedureDisplayName: proc?.display_name ?? null,
      planId: (r.plan_id as string | null) ?? null,
      planName: plan?.name ?? null,
      sourcePriceVersionId: (r.source_price_version_id as string | null) ?? null,
      lineAmountCents: Number(r.line_amount_cents ?? 0),
      vigenteAmountCents: Number(r.vigente_amount_cents ?? 0),
      amountWasOverridden: Boolean(r.amount_was_overridden),
      sequence: Number(r.sequence ?? 0),
      quantity: Math.max(1, Number(r.quantity ?? 1)),
      createdAt: r.created_at as string,
      createdBy: r.created_by as string,
    }
  })
}
