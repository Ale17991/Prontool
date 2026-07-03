import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { tryResolvePrice } from '@/lib/core/pricing/resolve-price'

/**
 * Anexa um NOVO procedimento a um atendimento já existente (evita criar outro
 * atendimento quando o paciente precisa de algo a mais). A linha entra em
 * `appointment_procedures` (service_role é isento do append-only) e o total
 * `appointments.frozen_amount_cents` é atualizado para a linha ser faturada.
 *
 * Plano = o do próprio atendimento (convênio ou particular). Preço resolvido
 * pela tabela vigente (convênio) ou padrão do procedimento (particular), com
 * valor editável. NÃO bloqueia por status (decisão do usuário): pode adicionar
 * mesmo após realizado — altera o total já contabilizado.
 */
export async function addProcedureToAppointment(
  supabase: SupabaseClient<Database>,
  input: {
    tenantId: string
    appointmentId: string
    procedureId: string
    actorUserId: string
    quantity?: number
    /** Valor unitário em centavos; ausente = usa o vigente/padrão. */
    amountCentsOverride?: number | null
  },
): Promise<{ id: string }> {
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1))

  const { data: apptRaw, error: aErr } = await supabase
    .from('appointments')
    .select('id, tenant_id, appointment_at, plan_id, frozen_amount_cents')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.appointmentId)
    .maybeSingle()
  if (aErr) throw new Error(`addProcedureToAppointment load appointment failed: ${aErr.message}`)
  const appt = apptRaw as {
    appointment_at: string
    plan_id: string | null
    frozen_amount_cents: number
  } | null
  if (!appt) throw new NotFoundError('appointment', input.appointmentId)

  const { data: procRaw, error: pErr } = await supabase
    .from('procedures')
    .select('default_amount_cents')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.procedureId)
    .maybeSingle()
  if (pErr) throw new Error(`addProcedureToAppointment load procedure failed: ${pErr.message}`)
  if (!procRaw) throw new NotFoundError('procedure', input.procedureId)
  const defaultAmount =
    (procRaw as { default_amount_cents: number | null }).default_amount_cents ?? 0

  // Preço vigente + price_version (a trava de coerência exige pv p/ convênio).
  let vigente: number
  let sourcePvId: string | null
  if (appt.plan_id) {
    const resolved = await tryResolvePrice(supabase, {
      tenantId: input.tenantId,
      procedureId: input.procedureId,
      planId: appt.plan_id,
      asOf: new Date(appt.appointment_at),
    })
    if (!resolved) {
      throw new ValidationError(
        'Sem preço de tabela vigente para este procedimento neste convênio. Cadastre o preço antes.',
      )
    }
    vigente = resolved.amountCents
    sourcePvId = resolved.priceVersionId
  } else {
    vigente = defaultAmount
    sourcePvId = null
  }

  const line = input.amountCentsOverride ?? vigente
  if (!Number.isFinite(line) || line < 0) throw new ValidationError('Valor inválido.')
  const overridden =
    input.amountCentsOverride !== null &&
    input.amountCentsOverride !== undefined &&
    input.amountCentsOverride !== vigente

  const { data: maxRow } = await supabase
    .from('appointment_procedures')
    .select('sequence')
    .eq('appointment_id', input.appointmentId)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextSeq = ((maxRow as { sequence: number } | null)?.sequence ?? 0) + 1

  const { data: ins, error: iErr } = await supabase
    .from('appointment_procedures' as never)
    .insert({
      tenant_id: input.tenantId,
      appointment_id: input.appointmentId,
      procedure_id: input.procedureId,
      plan_id: appt.plan_id,
      source_price_version_id: sourcePvId,
      line_amount_cents: line,
      vigente_amount_cents: vigente,
      amount_was_overridden: overridden,
      sequence: nextSeq,
      created_by: input.actorUserId,
      quantity,
    } as never)
    .select('id')
    .single()
  if (iErr) throw new Error(`addProcedureToAppointment insert failed: ${iErr.message}`)

  // Atualiza o total congelado (service_role não é barrado pelo REVOKE da 0018).
  const newFrozen = (appt.frozen_amount_cents ?? 0) + line * quantity
  const { error: uErr } = await supabase
    .from('appointments')
    .update({ frozen_amount_cents: newFrozen } as never)
    .eq('tenant_id', input.tenantId)
    .eq('id', input.appointmentId)
  if (uErr) throw new Error(`addProcedureToAppointment update total failed: ${uErr.message}`)

  return { id: (ins as { id: string }).id }
}
