import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  DomainError,
  NotFoundError,
  TussCodeRetiredError,
  WebhookPayloadError,
} from '@/lib/observability/errors'
import {
  extractCustomFields,
  type ExtractedEvent,
} from '@/lib/integrations/ghl/extract-custom-fields'
import { upsertPatientFromGhl } from '@/lib/core/patients/upsert-from-ghl'
import { resolvePrice } from '@/lib/core/pricing/resolve-price'
import { resolveCommission } from '@/lib/core/commissions/resolve-commission'

/**
 * T082 — end-to-end creation of an `appointments` row from a persisted
 * raw GHL event. Pipeline:
 *   1. Load raw event + tenant config.
 *   2. Extract custom fields against the tenant's field map (T077).
 *   3. Resolve TUSS catalog (reject if retired → DLQ).
 *   4. Match procedure / plan / doctor within tenant scope.
 *   5. Upsert patient with encrypted PII (T081).
 *   6. Freeze price (T079) and commission (T080).
 *   7. Insert appointment with all source FKs populated.
 *
 * Throws typed `DomainError`s that `process-event.ts` (T083) maps onto
 * DLQ transitions and `dispatchAlert` calls. Transient/unknown errors are
 * re-thrown so QStash retries.
 */
export interface CreateFromEventInput {
  rawEventId: string
  actorId?: string
}

export interface CreateFromEventResult {
  appointmentId: string
  frozenAmountCents: number
  frozenCommissionBps: number
  priceVersionId: string
  commissionHistoryId: string
  patientId: string
}

export async function createAppointmentFromEvent(
  supabase: SupabaseClient<Database>,
  input: CreateFromEventInput,
): Promise<CreateFromEventResult> {
  const raw = await supabase
    .from('raw_webhook_events')
    .select('id, tenant_id, payload, received_at')
    .eq('id', input.rawEventId)
    .single()
  if (raw.error || !raw.data) throw new NotFoundError('raw_webhook_events', input.rawEventId)

  const tenantId = raw.data.tenant_id
  const config = await supabase
    .from('tenant_ghl_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .single()
  if (config.error || !config.data) throw new NotFoundError('tenant_ghl_config', tenantId)

  const extracted = extractCustomFields(raw.data.payload, config.data)
  const appointmentAt = resolveAppointmentAt(extracted, raw.data.received_at)

  const procedureId = await resolveProcedure(supabase, tenantId, extracted.tussCode)
  const planId = await resolvePlan(supabase, tenantId, extracted.plano)
  const doctorId = await resolveDoctor(supabase, tenantId, extracted.medicoIdentifier)

  const { patientId } = await upsertPatientFromGhl(supabase, {
    tenantId,
    ghlContactId: extracted.ghlContactId,
    fullName: extracted.patient.fullName,
    cpf: extracted.patient.cpf,
    phone: extracted.patient.phone,
    email: extracted.patient.email,
    birthDate: extracted.patient.birthDate,
    // Plano já resolvido acima — evita segunda busca por nome.
    planId,
  })

  let price: Awaited<ReturnType<typeof resolvePrice>>
  try {
    price = await resolvePrice(supabase, {
      tenantId,
      procedureId,
      planId,
      asOf: appointmentAt,
    })
  } catch (err) {
    if (err instanceof DomainError && err.code === 'APPOINTMENT_PRICE_MISSING') {
      // Enrich with human-readable identifiers so the DLQ alert detail tells
      // the operator exactly which plan/procedure combination needs a price.
      throw new DomainError(err.code, err.message, {
        status: err.statusHint,
        meta: {
          ...(err.meta ?? {}),
          plan_name: extracted.plano,
          tuss_code: extracted.tussCode,
        },
      })
    }
    throw err
  }
  const commission = await resolveCommission(supabase, {
    tenantId,
    doctorId,
    asOf: appointmentAt,
  })

  // Webhooks GHL trazem 1 procedimento — usamos a RPC nova com uma unica
  // linha. Mantem appointment_procedures como source-of-truth uniforme
  // (mesmo padrao do fluxo manual com multiplos procedimentos).
  // p_source_raw_event_id ativa o unique index (tenant_id, source_raw_event_id)
  // garantindo idempotencia (webhook delivery duplicado nao gera dup).
  const inserted = await supabase.rpc(
    'create_appointment_with_procedures_and_materials' as never,
    {
      p_tenant_id: tenantId,
      p_patient_id: patientId,
      p_doctor_id: doctorId,
      p_appointment_at: appointmentAt.toISOString(),
      p_duration_minutes: null,
      p_observacoes: null,
      p_source: 'ghl',
      p_actor: input.actorId ?? '00000000-0000-0000-0000-000000000001',
      p_procedures: [
        {
          procedure_id: procedureId,
          plan_id: planId,
          source_price_version_id: price.priceVersionId,
          line_amount_cents: price.amountCents,
          vigente_amount_cents: price.amountCents,
          amount_was_overridden: false,
          sequence: 1,
        },
      ],
      p_frozen_commission_bps: commission.percentageBps,
      p_source_commission_history_id: commission.commissionHistoryId,
      p_materials: [],
      p_source_raw_event_id: input.rawEventId,
    } as never,
  )

  if (inserted.error) {
    throw new Error(`createAppointmentFromEvent RPC failed: ${inserted.error.message}`)
  }

  const data = inserted.data as { appointment_id: string } | null
  if (!data?.appointment_id) {
    throw new Error('createAppointmentFromEvent: empty response')
  }

  return {
    appointmentId: data.appointment_id,
    frozenAmountCents: price.amountCents,
    frozenCommissionBps: commission.percentageBps,
    priceVersionId: price.priceVersionId,
    commissionHistoryId: commission.commissionHistoryId,
    patientId,
  }
}

function resolveAppointmentAt(e: ExtractedEvent, receivedAt: string): Date {
  const source = e.appointmentAt ?? e.occurredAt ?? receivedAt
  const d = new Date(source)
  if (Number.isNaN(d.getTime())) {
    throw new WebhookPayloadError('appointment_at is not a valid ISO timestamp', {
      value: source,
    })
  }
  return d
}

async function resolveProcedure(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  tussCode: string,
): Promise<string> {
  const procedure = await supabase
    .from('procedures')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('tuss_code', tussCode)
    .maybeSingle()
  if (procedure.error) throw new Error(`resolveProcedure failed: ${procedure.error.message}`)
  if (!procedure.data) {
    throw new DomainError(
      'TUSS_CODE_UNKNOWN',
      `Tenant has no procedure configured for TUSS ${tussCode}`,
      { meta: { tenant_id: tenantId, tuss_code: tussCode } },
    )
  }

  const tuss = await supabase
    .from('tuss_codes')
    .select('code, valid_to')
    .eq('code', tussCode)
    .maybeSingle()
  if (tuss.error) throw new Error(`tuss_codes lookup failed: ${tuss.error.message}`)
  if (!tuss.data) {
    throw new DomainError('TUSS_CODE_UNKNOWN', `TUSS code ${tussCode} absent from catalog`, {
      meta: { tuss_code: tussCode },
    })
  }
  const today = new Date().toISOString().slice(0, 10)
  if (tuss.data.valid_to && tuss.data.valid_to < today) {
    throw new TussCodeRetiredError(tussCode, tuss.data.valid_to)
  }

  return procedure.data.id
}

async function resolvePlan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  planName: string,
): Promise<string> {
  const plan = await supabase
    .from('health_plans')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('name', planName)
    .maybeSingle()
  if (plan.error) throw new Error(`resolvePlan failed: ${plan.error.message}`)
  if (!plan.data) {
    throw new DomainError('PLAN_UNKNOWN', `Tenant has no plan named "${planName}"`, {
      meta: { tenant_id: tenantId, plan_name: planName },
    })
  }
  return plan.data.id
}

async function resolveDoctor(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  identifier: string,
): Promise<string> {
  const doctor = await supabase
    .from('doctors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('crm', identifier)
    .maybeSingle()
  if (doctor.error) throw new Error(`resolveDoctor failed: ${doctor.error.message}`)
  if (!doctor.data) {
    throw new DomainError(
      'DOCTOR_UNKNOWN',
      `Tenant has no doctor with identifier "${identifier}"`,
      { meta: { tenant_id: tenantId, identifier } },
    )
  }
  return doctor.data.id
}
