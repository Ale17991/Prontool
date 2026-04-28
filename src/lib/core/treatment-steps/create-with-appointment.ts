import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'
import { resolvePrice } from '@/lib/core/pricing/resolve-price'
import { resolveCommission } from '@/lib/core/commissions/resolve-commission'

/**
 * Cria uma etapa de tratamento JUNTO com o atendimento agendado correspondente,
 * via RPC `create_step_with_appointment` (transacional no banco).
 *
 * Diferenca para createTreatmentStep:
 *   - exige scheduled_date + start_time + end_time
 *   - exige health_plan_id (para resolver preco)
 *   - resultado: step + appointment vinculados (treatment_plan_steps.appointment_id)
 *   - dispara o trigger de slot_lock — pode falhar com 23P01 → DomainError
 *     APPOINTMENT_CONFLICT
 */
export interface CreateStepWithAppointmentInput {
  tenantId: string
  actorUserId: string
  patientId: string
  procedureId: string
  doctorId: string
  healthPlanId: string | null
  title: string
  notes: string | null
  scheduledDate: string // YYYY-MM-DD
  startTime: string // HH:MM
  endTime: string // HH:MM
}

export interface CreateStepWithAppointmentResult {
  step_id: string
  appointment_id: string
  scheduled_at: string
  duration_minutes: number
}

export async function createStepWithAppointment(
  supabase: SupabaseClient<Database>,
  input: CreateStepWithAppointmentInput,
): Promise<CreateStepWithAppointmentResult> {
  const startMin = toMinutes(input.startTime)
  const endMin = toMinutes(input.endTime)
  let durationMin = endMin - startMin
  if (durationMin <= 0) durationMin += 1440 // cruza meia-noite
  if (durationMin < 5 || durationMin > 480) {
    throw new DomainError('INVALID_DURATION', 'Duracao deve estar entre 5 e 480 minutos', {
      status: 400,
    })
  }

  // Combina date + time em fuso local da clinica (Brasil) e converte para UTC.
  // Como o Node nao tem tzdb embarcada, usamos o offset do servidor — que em
  // dev e Brasil; em Vercel e UTC. Para portabilidade futura, considerar luxon.
  // Atalho: construimos o ISO local "YYYY-MM-DDTHH:MM:00" e deixamos new Date()
  // interpretar como local. Em Vercel UTC, o date sera lido como UTC, gerando
  // um offset de fuso. TODO: testar com luxon ou tz-data quando deploy mudar.
  const startAt = new Date(`${input.scheduledDate}T${input.startTime}:00`)
  if (Number.isNaN(startAt.getTime())) {
    throw new DomainError('INVALID_DATE', 'Data/horario invalido', { status: 400 })
  }

  // Validacoes de FK no tenant (evitam vazamento entre tenants).
  await Promise.all([
    ensureBelongsToTenant(supabase, 'patients', input.patientId, input.tenantId, 'PATIENT_NOT_FOUND'),
    ensureBelongsToTenant(supabase, 'doctors', input.doctorId, input.tenantId, 'DOCTOR_NOT_FOUND'),
    ensureBelongsToTenant(supabase, 'procedures', input.procedureId, input.tenantId, 'PROCEDURE_NOT_FOUND'),
  ])

  // Resolve plano de saude — se ausente, cria etapa avulsa (preco fica null).
  // Mas a RPC exige plan_id. Se ausente, usamos plano default do paciente.
  let planIdForPricing = input.healthPlanId
  if (!planIdForPricing) {
    const pat = await supabase
      .from('patients')
      .select('plan_id')
      .eq('id', input.patientId)
      .eq('tenant_id', input.tenantId)
      .maybeSingle()
    planIdForPricing = pat.data?.plan_id ?? null
  }
  if (!planIdForPricing) {
    throw new DomainError(
      'HEALTH_PLAN_REQUIRED',
      'Plano de saude obrigatorio (paciente nao tem plano default)',
      { status: 400 },
    )
  }

  const [price, commission] = await Promise.all([
    resolvePrice(supabase, {
      tenantId: input.tenantId,
      procedureId: input.procedureId,
      planId: planIdForPricing,
      asOf: startAt,
    }),
    resolveCommission(supabase, {
      tenantId: input.tenantId,
      doctorId: input.doctorId,
      asOf: startAt,
    }),
  ])

  const { data, error } = await supabase.rpc('create_step_with_appointment', {
    p_tenant_id: input.tenantId,
    p_patient_id: input.patientId,
    p_procedure_id: input.procedureId,
    p_doctor_id: input.doctorId,
    p_plan_id: planIdForPricing,
    p_appointment_at: startAt.toISOString(),
    p_duration_minutes: durationMin,
    p_title: input.title.trim(),
    p_notes: input.notes?.trim() ?? '',
    p_created_by: input.actorUserId,
    p_amount_cents: price.amountCents,
    p_commission_bps: commission.percentageBps,
    p_price_version_id: price.priceVersionId,
    p_commission_history_id: commission.commissionHistoryId,
  })

  if (error) {
    const msg = error.message ?? ''
    if (/APPOINTMENT_CONFLICT/i.test(msg) || /exclusion_violation/i.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_CONFLICT',
        'Já existe atendimento para este profissional no horário escolhido.',
        { status: 409 },
      )
    }
    throw new Error(`createStepWithAppointment failed: ${msg}`)
  }

  // RPC retorna SETOF (step_id UUID, appointment_id UUID) — o supabase-js
  // retorna como array de objetos.
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') {
    throw new Error('createStepWithAppointment: empty response')
  }
  const result = row as { step_id: string; appointment_id: string }

  return {
    step_id: result.step_id,
    appointment_id: result.appointment_id,
    scheduled_at: startAt.toISOString(),
    duration_minutes: durationMin,
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
    throw new NotFoundError(table, id)
  }
}

function toMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return 0
  return parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10)
}
