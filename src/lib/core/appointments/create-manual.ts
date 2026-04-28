import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError, TussCodeRetiredError } from '@/lib/observability/errors'
import { resolvePrice } from '@/lib/core/pricing/resolve-price'
import { resolveCommission } from '@/lib/core/commissions/resolve-commission'

/**
 * Create an appointment manually (admin/recepcionista flow) — no raw_webhook_event.
 * Mirrors create-from-event.ts but takes IDs directly instead of resolving
 * them from a GHL payload. Price and commission are resolved against the
 * vigente versions and frozen into the row (Principle I / append-only).
 *
 * `amountCentsOverride` allows the operator to record a value different
 * from the vigente table (e.g., paciente particular pagou menos). The
 * `source_price_version_id` still points to the version that WAS vigente,
 * preserving the audit trail. The override itself is appended to audit_log
 * by the caller via appointment.price_override — this function does not
 * touch audit_log directly (keeps it pure).
 */
export interface CreateManualAppointmentInput {
  tenantId: string
  actorUserId: string
  patientId: string
  doctorId: string
  procedureId: string
  planId: string
  /** ISO-8601 UTC. */
  appointmentAt: string
  amountCentsOverride?: number
  /** Duracao em minutos, 5-480. Quando ausente, persiste NULL e a leitura usa default 30. */
  durationMinutes?: number
  observacoes?: string
}

export interface CreateManualAppointmentResult {
  appointmentId: string
  frozenAmountCents: number
  frozenCommissionBps: number
  priceVersionId: string
  commissionHistoryId: string
  amountWasOverridden: boolean
  vigenteAmountCents: number
}

export async function createAppointmentManually(
  supabase: SupabaseClient<Database>,
  input: CreateManualAppointmentInput,
): Promise<CreateManualAppointmentResult> {
  const when = new Date(input.appointmentAt)
  if (Number.isNaN(when.getTime())) {
    throw new DomainError('INVALID_BODY', 'appointment_at is not a valid ISO timestamp')
  }
  // Datas no futuro sao permitidas — viram atendimentos com status 'agendado'
  // na view appointments_effective. Quando NOW() ultrapassa o appointment_at,
  // o status muda para 'ativo' automaticamente (sem UPDATE no registro).

  // Validate every FK lives in the same tenant. Cross-tenant → 404 per contract.
  await Promise.all([
    ensureBelongsToTenant(supabase, 'patients', input.patientId, input.tenantId, 'PATIENT_NOT_FOUND'),
    ensureBelongsToTenant(supabase, 'doctors', input.doctorId, input.tenantId, 'DOCTOR_NOT_FOUND'),
    ensureBelongsToTenant(
      supabase,
      'procedures',
      input.procedureId,
      input.tenantId,
      'PROCEDURE_NOT_FOUND',
    ),
    ensureBelongsToTenant(supabase, 'health_plans', input.planId, input.tenantId, 'PLAN_NOT_FOUND'),
  ])

  // Validate the procedure's TUSS code is still vigente.
  const procedure = await supabase
    .from('procedures')
    .select('tuss_code')
    .eq('id', input.procedureId)
    .single()
  if (procedure.error || !procedure.data) {
    throw new NotFoundError('procedures', input.procedureId)
  }
  const tussCode = procedure.data.tuss_code as string
  const tuss = await supabase
    .from('tuss_codes')
    .select('code, valid_to')
    .eq('code', tussCode)
    .maybeSingle()
  if (!tuss.data) {
    throw new DomainError('TUSS_CODE_UNKNOWN', `TUSS code ${tussCode} absent from catalog`)
  }
  const today = new Date().toISOString().slice(0, 10)
  if (tuss.data.valid_to && tuss.data.valid_to < today) {
    throw new TussCodeRetiredError(tussCode, tuss.data.valid_to)
  }

  const price = await resolvePrice(supabase, {
    tenantId: input.tenantId,
    procedureId: input.procedureId,
    planId: input.planId,
    asOf: when,
  })
  const commission = await resolveCommission(supabase, {
    tenantId: input.tenantId,
    doctorId: input.doctorId,
    asOf: when,
  })

  const amountToFreeze =
    input.amountCentsOverride !== undefined ? input.amountCentsOverride : price.amountCents
  const overridden =
    input.amountCentsOverride !== undefined && input.amountCentsOverride !== price.amountCents

  const baseRow = {
    tenant_id: input.tenantId,
    patient_id: input.patientId,
    doctor_id: input.doctorId,
    procedure_id: input.procedureId,
    plan_id: input.planId,
    source_price_version_id: price.priceVersionId,
    source_commission_history_id: commission.commissionHistoryId,
    source_raw_event_id: null,
    frozen_amount_cents: amountToFreeze,
    frozen_commission_bps: commission.percentageBps,
    appointment_at: when.toISOString(),
    source: 'manual',
    observacoes: input.observacoes ?? null,
  }

  // Tenta inserir com duration_minutes (migration 0053). Se a coluna nao
  // existir no ambiente atual (migration ainda nao aplicada), tenta de novo
  // sem o campo — preserva o registro do atendimento e perde apenas a
  // duracao customizada (UI cai no default de 30 min na leitura).
  let inserted = await supabase
    .from('appointments')
    .insert({
      ...baseRow,
      duration_minutes: input.durationMinutes ?? null,
    } as never)
    .select('id')
    .single()

  // Fallbacks graciosos para colunas adicionadas em migrations posteriores
  // que talvez ainda nao tenham aplicado em todos os ambientes.
  if (
    inserted.error &&
    /(duration_minutes|observacoes)/i.test(inserted.error.message) &&
    /does not exist/i.test(inserted.error.message)
  ) {
    // Remove campos opcionais e tenta de novo. O atendimento e gravado;
    // perdem-se apenas duracao customizada e observacoes (na UI essas
    // viram default/empty na leitura).
    const fallbackRow = {
      tenant_id: baseRow.tenant_id,
      patient_id: baseRow.patient_id,
      doctor_id: baseRow.doctor_id,
      procedure_id: baseRow.procedure_id,
      plan_id: baseRow.plan_id,
      source_price_version_id: baseRow.source_price_version_id,
      source_commission_history_id: baseRow.source_commission_history_id,
      source_raw_event_id: baseRow.source_raw_event_id,
      frozen_amount_cents: baseRow.frozen_amount_cents,
      frozen_commission_bps: baseRow.frozen_commission_bps,
      appointment_at: baseRow.appointment_at,
      source: baseRow.source,
    }
    inserted = await supabase
      .from('appointments')
      .insert(fallbackRow as never)
      .select('id')
      .single()
  }

  if (inserted.error || !inserted.data) {
    const msg = inserted.error?.message ?? ''
    // Trigger appointments_create_slot_lock levanta SQLSTATE 23P01 com prefixo
    // APPOINTMENT_CONFLICT quando ha overlap com outro atendimento ativo do
    // mesmo profissional. Convertemos para DomainError 409 — toHttpResponse
    // ja mapeia para HTTP 409 com payload.
    if (/APPOINTMENT_CONFLICT/i.test(msg) || /exclusion_violation/i.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_CONFLICT',
        'Já existe atendimento para este profissional no horário escolhido.',
        { status: 409 },
      )
    }
    throw new Error(`createAppointmentManually insert failed: ${msg}`)
  }

  // Auto-link FIFO: se existe etapa pendente do mesmo (patient, procedure)
  // sem appointment vinculado, cria o vinculo (column-guard relaxado aceita
  // SET appointment_id quando OLD e NULL — one-shot link).
  // Falha silenciosa: vincular e nice-to-have, atendimento ja foi criado.
  try {
    const linkable = await supabase
      .from('treatment_plan_steps')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('patient_id', input.patientId)
      .eq('procedure_id', input.procedureId)
      .eq('status', 'pendente')
      .is('appointment_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (linkable.data) {
      await supabase
        .from('treatment_plan_steps')
        .update({ appointment_id: inserted.data.id } as never)
        .eq('id', linkable.data.id)
    }
  } catch {
    // ignora — atendimento foi criado, vinculo opcional
  }

  return {
    appointmentId: inserted.data.id,
    frozenAmountCents: amountToFreeze,
    frozenCommissionBps: commission.percentageBps,
    priceVersionId: price.priceVersionId,
    commissionHistoryId: commission.commissionHistoryId,
    amountWasOverridden: overridden,
    vigenteAmountCents: price.amountCents,
  }
}

async function ensureBelongsToTenant(
  supabase: SupabaseClient<Database>,
  table: 'patients' | 'doctors' | 'procedures' | 'health_plans',
  id: string,
  tenantId: string,
  notFoundCode: string,
): Promise<void> {
  const res = await supabase
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (res.error) throw new Error(`${table} lookup failed: ${res.error.message}`)
  if (!res.data) {
    throw new DomainError(notFoundCode, `${table} not found for tenant`, { status: 404 })
  }
}
