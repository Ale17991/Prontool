/**
 * Feature 018 — POST /api/lembretes/[id]/reenviar
 *
 * Reenvio manual de lembrete para um agendamento específico (US3, Q2).
 * `id` no path é o `appointmentId` (não o `reminder.id`).
 *
 * RBAC: admin OU recepcionista (action `reminders.config`).
 * Status anterior NÃO importa — admin pode reenviar mesmo lembretes já
 * enviados com sucesso (clarificação Q2).
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { ForbiddenError, UnauthorizedError } from '@/lib/observability/errors'
import type { Database } from '@/lib/db/types'
import { sendOneReminder } from '@/lib/core/reminders/send-one'
import type {
  EligibleAppointment,
  TenantReminderSettings,
} from '@/lib/core/reminders/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
) {
  const appointmentId = context.params.id
  if (!appointmentId) {
    return NextResponse.json({ error: 'APPOINTMENT_NOT_FOUND' }, { status: 404 })
  }

  // 1. Auth — admin OU recepcionista (ambos têm reminders.config).
  let session
  try {
    session = await requireRole(['admin', 'recepcionista'], {
      entity: 'appointment_reminders',
      entityId: appointmentId,
      route: `/api/lembretes/${appointmentId}/reenviar`,
      request,
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    }
    throw err
  }

  // 2. Carrega contexto via service-role (precisa decrypt PII + write em reminders)
  const supabase = createSupabaseServiceClient()
  const userClient = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  // userClient apenas para RLS-bound verification que o appointment é do tenant.
  void userClient

  const apptRes = await supabase
    .from('appointments')
    .select(
      `id, tenant_id, appointment_at, doctor_id, procedure_id, patient_id,
       doctors!inner(full_name, active),
       procedures!inner(display_name, tuss_code),
       patients!inner(email_enc, reminders_opt_in)`,
    )
    .eq('id', appointmentId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle()

  if (apptRes.error || !apptRes.data) {
    return NextResponse.json({ error: 'APPOINTMENT_NOT_FOUND' }, { status: 404 })
  }

  const a = apptRes.data as unknown as {
    id: string
    tenant_id: string
    appointment_at: string
    doctor_id: string
    procedure_id: string
    patient_id: string
    doctors: { full_name: string; active: boolean } | null
    procedures: { display_name: string | null; tuss_code: string | null } | null
    patients: { email_enc: string | null; reminders_opt_in: boolean | null | undefined } | null
  }

  // 3. Valida elegibilidade
  if (!a.patients?.email_enc) {
    return NextResponse.json(
      { error: 'NOT_ELIGIBLE', code: 'NO_EMAIL' },
      { status: 422 },
    )
  }
  if ((a.patients.reminders_opt_in as boolean | null) === false) {
    return NextResponse.json(
      { error: 'NOT_ELIGIBLE', code: 'PATIENT_OPT_OUT' },
      { status: 422 },
    )
  }

  const revRes = await supabase
    .from('appointment_reversals')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .eq('appointment_id', appointmentId)
    .maybeSingle()
  if (revRes.data) {
    return NextResponse.json(
      { error: 'NOT_ELIGIBLE', code: 'REVERSED' },
      { status: 422 },
    )
  }

  // 4. Carrega config + clinic info do tenant
  const clinicRes = await supabase
    .from('tenant_clinic_profile')
    .select(
      `phone, corporate_name, public_booking_slug, public_booking_enabled,
       reminder_template_subject, reminder_template_body,
       reminder_offsets_hours, reminder_send_weekends,
       reminder_window_start, reminder_window_end`,
    )
    .eq('tenant_id', session.tenantId)
    .maybeSingle()
  const clinic = (clinicRes.data ?? {}) as {
    phone: string | null
    corporate_name: string | null
    public_booking_slug: string | null
    public_booking_enabled: boolean | null
    reminder_template_subject: string | null
    reminder_template_body: string | null
    reminder_offsets_hours: number[] | null
    reminder_send_weekends: boolean | null
    reminder_window_start: string | null
    reminder_window_end: string | null
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
  const publicBookingUrl =
    clinic.public_booking_enabled === true && clinic.public_booking_slug
      ? `${appUrl}/agendar/${clinic.public_booking_slug}`
      : null

  const settings: TenantReminderSettings = {
    tenantId: session.tenantId,
    timezone: 'America/Sao_Paulo',
    enabled: true,
    offsetsHours: clinic.reminder_offsets_hours ?? [24],
    sendWeekends: clinic.reminder_send_weekends ?? true,
    windowStart: (clinic.reminder_window_start ?? '08:00').slice(0, 5),
    windowEnd: (clinic.reminder_window_end ?? '20:00').slice(0, 5),
    templateSubject: clinic.reminder_template_subject,
    templateBody: clinic.reminder_template_body,
    lastRunAt: null,
  }

  const eligible: EligibleAppointment = {
    appointmentId: a.id,
    tenantId: a.tenant_id,
    appointmentAt: a.appointment_at,
    doctorId: a.doctor_id,
    doctorFullName: a.doctors?.full_name ?? '—',
    doctorActive: a.doctors?.active === true,
    procedureId: a.procedure_id,
    procedureName: a.procedures?.display_name ?? a.procedures?.tuss_code ?? '—',
    patientId: a.patient_id,
    patientFullName: '',
    patientEmail: a.patients.email_enc ? '__encrypted__' : null,
    remindersOptIn: a.patients.reminders_opt_in !== false,
    isReversed: false,
  }

  // 5. Send
  logger.info(
    { appointmentId, actorUserId: session.userId },
    'manual-resend-start',
  )

  try {
    const record = await sendOneReminder({
      supabase,
      eligible,
      settings,
      offsetHours: -1, // sentinela manual
      isManual: true,
      clinicName: clinic.corporate_name ?? 'Clínica',
      clinicPhone: clinic.phone,
      publicBookingUrl,
    })

    if (!record) {
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
    }

    logger.info(
      { appointmentId, reminderId: record.id, status: record.status },
      'manual-resend-done',
    )

    return NextResponse.json(
      {
        reminderId: record.id,
        status: record.status,
        providerMessageId: record.providerMessageId,
        errorMessage: record.error,
      },
      { status: 200 },
    )
  } catch (err) {
    logger.error(
      { appointmentId, errorCode: err instanceof Error ? err.name : 'unknown' },
      'manual-resend-fatal',
    )
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
