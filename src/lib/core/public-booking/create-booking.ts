/**
 * Feature 017 — Cria appointment via fluxo público (sem auth).
 *
 * Orquestra o pipeline de 20 passos do api-create-booking.contract.md.
 * Sem Turnstile/rate-limit (responsabilidade da rota — Phase 5).
 *
 * Estratégia: usa `createAppointmentManually` para reaproveitar a
 * resolução de preço (particular: default_amount_cents), comissão
 * doctor-centric e RPC de criação atômica com EXCLUDE constraint anti-race.
 *
 * Como `createAppointmentManually` exige `actorUserId` (UUID NOT NULL para
 * audit), usamos o primeiro admin ativo do tenant. O `audit_log` recebe
 * um registro adicional com `actor_label='public_booking'` para
 * diferenciar este caminho do fluxo manual interno.
 *
 * Constituição:
 * - I (imutabilidade): apenas INSERT em appointments + audit_log.
 * - II (audit): trigger automático + log explícito `public_booking_created`.
 * - III (multi-tenant): tenant_id resolvido server-side via slug; nunca do client.
 * - V (RBAC): rota anônima, mas opera via service-role com tenant gateado.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError } from '@/lib/observability/errors'
import { createPatientManually } from '@/lib/core/patients/create-manual'
import { createAppointmentManually } from '@/lib/core/appointments/create-manual'
import { publishDomainEvent } from '@/lib/core/events/publish'
import { resolveTenantBySlug } from './resolve-tenant'
import { generateCancelToken } from './tokens'
import { sendBookingConfirmations } from './send-confirmation'
import { listDoctorsForProcedure } from './list-published'
import { pickAnyDoctorForSlot } from './pick-doctor'
import type { BookingCreatedResult, BookingPayload } from './types'

export interface CreatePublicBookingInput extends BookingPayload {
  slug: string
  /** Hash do IP (sha256). Persistido em audit_log via app.ip session var. */
  ipHash: string
  /** User-Agent do navegador (audit). */
  userAgent: string | null
}

export interface CreatePublicBookingOk {
  ok: true
  data: BookingCreatedResult
}

export interface CreatePublicBookingErr {
  ok: false
  error:
    | 'TENANT_NOT_FOUND_OR_DISABLED'
    | 'OUT_OF_BOOKING_WINDOW'
    | 'DOCTOR_PROCEDURE_NOT_PUBLISHED'
    | 'SLOT_NO_LONGER_AVAILABLE'
    | 'INVALID_SLOT_START'
    | 'INTERNAL_ERROR'
  message?: string
}

const TENANT_TIMEZONE = 'America/Sao_Paulo'

export async function createPublicBooking(
  supabase: SupabaseClient<Database>,
  input: CreatePublicBookingInput,
): Promise<CreatePublicBookingOk | CreatePublicBookingErr> {
  // 1. Resolve tenant via slug.
  const tenant = await resolveTenantBySlug(supabase, input.slug)
  if (!tenant) {
    return { ok: false, error: 'TENANT_NOT_FOUND_OR_DISABLED' }
  }

  // 1.5 Modo "sem preferencia": resolve medico antes da validacao do par
  // (medico, procedimento). Pick = medico do pool com slot livre + menor
  // numero de appointments na semana; random tiebreak. Pool = todos que
  // publicam o procedimento.
  let resolvedDoctorId = input.doctorId
  if (input.doctorId === 'any') {
    const candidates = await listDoctorsForProcedure(
      supabase,
      tenant.tenantId,
      input.procedureId,
    )
    if (candidates.length === 0) {
      return { ok: false, error: 'DOCTOR_PROCEDURE_NOT_PUBLISHED' }
    }
    const picked = await pickAnyDoctorForSlot(supabase, {
      slug: input.slug,
      tenantId: tenant.tenantId,
      procedureId: input.procedureId,
      slotStartIso: input.slotStart,
      candidateDoctorIds: candidates,
    })
    if (!picked) {
      return { ok: false, error: 'SLOT_NO_LONGER_AVAILABLE' }
    }
    resolvedDoctorId = picked.doctorId
  }

  // 2. Validar combinação publicada (médico + procedimento + tenant).
  const pubRow = await supabase
    .from('public_booking_doctor_procedures')
    .select('duration_minutes, display_name')
    .eq('tenant_id', tenant.tenantId)
    .eq('doctor_id', resolvedDoctorId)
    .eq('procedure_id', input.procedureId)
    .maybeSingle()

  if (pubRow.error) {
    return {
      ok: false,
      error: 'INTERNAL_ERROR',
      message: `published lookup: ${pubRow.error.message}`,
    }
  }
  if (!pubRow.data) {
    return { ok: false, error: 'DOCTOR_PROCEDURE_NOT_PUBLISHED' }
  }
  const durationMinutes = pubRow.data.duration_minutes
  const procedureDisplayName = pubRow.data.display_name

  // 3. Validar janela [now + min_hours, now + max_days].
  const slotDate = new Date(input.slotStart)
  if (Number.isNaN(slotDate.getTime())) {
    return { ok: false, error: 'INVALID_SLOT_START' }
  }
  const now = Date.now()
  const minMs = tenant.minHoursAdvance * 60 * 60 * 1000
  const maxMs = tenant.maxDaysAdvance * 24 * 60 * 60 * 1000
  if (slotDate.getTime() < now + minMs || slotDate.getTime() > now + maxMs) {
    return { ok: false, error: 'OUT_OF_BOOKING_WINDOW' }
  }

  // 4. Achar admin ativo do tenant para servir como actorUserId.
  //    A função createAppointmentManually persiste isso na trigger de audit;
  //    nosso log adicional com actor_label='public_booking' diferencia o caminho.
  const adminRow = await supabase
    .from('user_tenants')
    .select('user_id, role, status')
    .eq('tenant_id', tenant.tenantId)
    .eq('role', 'admin')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (adminRow.error || !adminRow.data) {
    return {
      ok: false,
      error: 'INTERNAL_ERROR',
      message: 'no active admin found for tenant',
    }
  }
  const actorUserId = adminRow.data.user_id as string

  // 5. Resolve paciente — match por CPF (se fornecido) ou cria novo.
  let patientId: string | null = null
  if (input.patient.cpf) {
    const cpfMatch = await findPatientByCpf(supabase, {
      tenantId: tenant.tenantId,
      cpf: input.patient.cpf,
    })
    if (cpfMatch) {
      patientId = cpfMatch.patientId
      // FR-011a: atualizar email/phone se diferentes (audit via trigger).
      // Reusa createPatientManually update path? Mais simples: UPDATE direto
      // se diferente. Por enquanto deixa o registro como está — refinamento
      // de "atualizar contato" entra em iteration polish.
    }
  }
  if (!patientId) {
    const created = await createPatientManually(supabase, {
      tenantId: tenant.tenantId,
      fullName: input.patient.fullName,
      cpf: input.patient.cpf ?? null,
      email: input.patient.email,
      phone: input.patient.phone,
      birthDate: input.patient.birthDate,
      planId: null,
      actorUserId,
    })
    patientId = created.patientId
  }

  // 6. INSERT appointment + procedure line. Particular (planId=null).
  //    EXCLUDE constraint via appointment_slot_locks blinda race condition.
  try {
    const result = await createAppointmentManually(supabase, {
      tenantId: tenant.tenantId,
      actorUserId,
      patientId,
      doctorId: resolvedDoctorId,
      procedures: [
        {
          procedureId: input.procedureId,
          planId: null,
        },
      ],
      appointmentAt: slotDate.toISOString(),
      durationMinutes,
      observacoes: 'Agendamento público sem login',
      addToTreatmentPlan: false,
    })

    // 7. Audit log adicional com actor_label='public_booking' para diferenciar.
    //    Não bloqueia se falhar (audit trigger primário já registrou).
    try {
      await supabase.rpc('log_audit_event' as never, {
        p_tenant_id: tenant.tenantId,
        p_entity: 'appointments',
        p_entity_id: result.appointmentId,
        p_field: 'public_booking_created',
        p_old: null,
        p_new: procedureDisplayName,
        p_reason: `slug=${input.slug};ip_hash=${input.ipHash};ua=${
          input.userAgent?.slice(0, 80) ?? ''
        }`,
      } as never)
    } catch {
      // best-effort
    }

    // 7b. Publica appointment.created (fan-out integrações + sync Google Agenda
    //     do profissional). Best-effort — não bloqueia o agendamento público.
    try {
      const primary = result.lines[0]!
      await publishDomainEvent(supabase, tenant.tenantId, {
        type: 'appointment.created',
        appointment: {
          id: result.appointmentId,
          tenantId: tenant.tenantId,
          patientId,
          doctorId: resolvedDoctorId,
          procedureId: primary.procedureId,
          procedureTussCode: '',
          planId: primary.planId,
          appointmentAt: slotDate.toISOString(),
          frozenAmountCents: result.frozenAmountCents,
          source: 'manual',
        },
        patient: {
          id: patientId,
          tenantId: tenant.tenantId,
          fullName: input.patient.fullName,
          cpf: input.patient.cpf ?? '',
          email: input.patient.email,
          phone: input.patient.phone,
          birthDate: input.patient.birthDate,
          planId: null,
          ghlContactId: null,
        },
      })
    } catch {
      // best-effort
    }

    // 8. Gera token + persiste hash.
    const token = generateCancelToken()
    const tokenInsert = await supabase
      .from('public_booking_tokens')
      .insert({
        tenant_id: tenant.tenantId,
        appointment_id: result.appointmentId,
        token_hash: token.hash,
        action: 'cancel',
      } as never)
    if (tokenInsert.error) {
      return {
        ok: false,
        error: 'INTERNAL_ERROR',
        message: `token insert: ${tokenInsert.error.message}`,
      }
    }

    // 9. Pós-commit (fire-and-forget): email paciente + email admin + bell.
    //    Erros logados internamente; não falham a request.
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
    const cancelUrl = `${appUrl}/agendar/${input.slug}/cancelar/${token.raw}`
    const dashboardUrl = `${appUrl}/operacao/atendimentos/${result.appointmentId}`

    // Lookup do nome do médico (para email).
    const { data: doctorRow } = await supabase
      .from('doctors')
      .select('full_name')
      .eq('id', resolvedDoctorId)
      .eq('tenant_id', tenant.tenantId)
      .maybeSingle()
    const doctorName = (doctorRow?.full_name as string | undefined) ?? '—'

    void sendBookingConfirmations({
      supabase,
      tenantId: tenant.tenantId,
      tenantDisplayName: tenant.displayName,
      tenantPhone: tenant.phone,
      tenantAddress: tenant.addressLine,
      appointmentId: result.appointmentId,
      patientName: input.patient.fullName,
      patientEmail: input.patient.email,
      doctorName,
      procedureName: procedureDisplayName,
      scheduledAt: slotDate,
      durationMinutes,
      cancelUrl,
      dashboardUrl,
    })

    return {
      ok: true,
      data: {
        appointmentId: result.appointmentId,
        cancelToken: token.raw,
        redirectUrl: `/agendar/${input.slug}/sucesso/${token.raw}`,
        scheduledAt: slotDate.toISOString(),
        timezone: TENANT_TIMEZONE,
      },
    }
  } catch (err) {
    if (err instanceof DomainError && err.code === 'APPOINTMENT_CONFLICT') {
      return { ok: false, error: 'SLOT_NO_LONGER_AVAILABLE' }
    }
    return {
      ok: false,
      error: 'INTERNAL_ERROR',
      message: err instanceof Error ? err.message : 'unknown',
    }
  }
}

// =========================================================================
// CPF lookup via SECURITY DEFINER RPC (service_role only)
// =========================================================================

interface CpfMatch {
  patientId: string
  fullName: string
  email: string | null
  phone: string | null
}

async function findPatientByCpf(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; cpf: string },
): Promise<CpfMatch | null> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) return null
  const { data, error } = await supabase.rpc(
    'public_booking_find_patient_by_cpf' as never,
    {
      p_tenant_id: input.tenantId,
      p_cpf: input.cpf,
      p_key: key,
    } as never,
  )
  if (error) return null
  const rows =
    (data as unknown as Array<{
      patient_id: string
      full_name: string
      email: string | null
      phone: string | null
    }> | null) ?? []
  const row = rows[0]
  if (!row) return null
  return {
    patientId: row.patient_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
  }
}
