import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { AppointmentSnapshot, DomainEvent } from '@/lib/integrations/types'
import { getTenantTimezone } from '@/lib/utils/tenant-tz'
import { withGoogleAuth } from '@/lib/integrations/google-calendar/oauth/with-auth'
import {
  createCalendarEvent,
  patchCalendarEvent,
  deleteCalendarEvent,
} from '@/lib/integrations/google-calendar/calendar-client'
import { logger } from '@/lib/observability/logger'

/**
 * Sincroniza atendimentos com o Google Calendar do PROFISSIONAL do atendimento.
 *
 * - appointment.created  → cria o evento na agenda do médico (se ele conectou).
 * - appointment.reversed → remove o evento (estorno/cancelamento).
 * Reagendamento no sistema = estorno + novo atendimento ⇒ remove o antigo e
 * cria o novo automaticamente (não há evento appointment.updated).
 *
 * Best-effort: qualquer falha é logada e NÃO derruba a criação do atendimento.
 * O mapa appointment→evento vive em `appointment_calendar_sync`.
 */

const PROVIDER = 'google_calendar'
const DEFAULT_DURATION_MIN = 30

function loose(supabase: SupabaseClient<Database>): SupabaseClient {
  return supabase as unknown as SupabaseClient
}

/** Médico → usuário (conta). Null = médico não vinculado a usuário. 1 query. */
async function resolveDoctorUser(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  doctorId: string,
): Promise<{ userId: string; doctorName: string | null } | null> {
  const { data } = await loose(supabase)
    .from('doctors')
    .select('user_id, full_name')
    .eq('tenant_id', tenantId)
    .eq('id', doctorId)
    .maybeSingle()
  const row = data as { user_id: string | null; full_name: string | null } | null
  if (!row?.user_id) return null
  return { userId: row.user_id, doctorName: row.full_name ?? null }
}

/** Detalhes do evento (duração/procedimento/fuso). Só carregado se houver Google conectado. */
async function loadEventDetails(
  supabase: SupabaseClient<Database>,
  appt: AppointmentSnapshot,
): Promise<{ durationMinutes: number; procedureName: string | null; timeZone: string }> {
  const sb = loose(supabase)
  const [apptRes, procRes, tz] = await Promise.all([
    sb.from('appointments').select('duration_minutes').eq('id', appt.id).maybeSingle(),
    appt.procedureId
      ? sb
          .from('procedures')
          .select('display_name')
          .eq('tenant_id', appt.tenantId)
          .eq('id', appt.procedureId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getTenantTimezone(supabase, appt.tenantId),
  ])
  return {
    durationMinutes:
      (apptRes.data as { duration_minutes: number | null } | null)?.duration_minutes ??
      DEFAULT_DURATION_MIN,
    procedureName: (procRes.data as { display_name: string | null } | null)?.display_name ?? null,
    timeZone: tz,
  }
}

async function recordSync(
  supabase: SupabaseClient<Database>,
  row: {
    appointmentId: string
    tenantId: string
    userId: string | null
    calendarId: string | null
    eventId: string | null
    status: 'synced' | 'deleted' | 'failed'
    error?: string | null
  },
): Promise<void> {
  await loose(supabase)
    .from('appointment_calendar_sync')
    .upsert(
      {
        appointment_id: row.appointmentId,
        provider: PROVIDER,
        tenant_id: row.tenantId,
        user_id: row.userId,
        calendar_id: row.calendarId,
        external_event_id: row.eventId,
        status: row.status,
        last_error: row.error ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'appointment_id,provider' },
    )
}

/**
 * Primeiro nome do paciente para o título do evento (best-effort). O snapshot
 * do event bus não carrega PII decifrada (`fullName` costuma vir vazio), então
 * decifra via RPC. É a agenda do próprio médico — exibir o nome é apropriado.
 * Degrada para o `fallback` (ou "Paciente") se a decifragem falhar.
 */
async function resolvePatientFirstName(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
  fallback: string,
): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) return fallback || 'Paciente'
  try {
    const { data, error } = await loose(supabase).rpc('get_patient_for_tenant', {
      p_tenant_id: tenantId,
      p_patient_id: patientId,
      p_key: key,
    })
    if (error) return fallback || 'Paciente'
    const full = ((data as Array<{ full_name: string | null }>) ?? [])[0]?.full_name ?? ''
    const first = full.trim().split(/\s+/)[0]
    return first || fallback || 'Paciente'
  } catch {
    return fallback || 'Paciente'
  }
}

async function onCreated(
  supabase: SupabaseClient<Database>,
  appt: AppointmentSnapshot,
  patientNameHint: string,
): Promise<void> {
  // 1) Médico → usuário (1 query). Sem vínculo → nada a fazer.
  const doctor = await resolveDoctorUser(supabase, appt.tenantId, appt.doctorId)
  if (!doctor) return

  // 2) Conexão Google ANTES de carregar o resto (caso comum: sem Google → sai barato).
  const auth = await withGoogleAuth(supabase, doctor.userId, appt.tenantId)
  if (auth.kind !== 'connected') return

  // 3) Só agora carrega detalhes + nome do paciente.
  const [details, patientName] = await Promise.all([
    loadEventDetails(supabase, appt),
    resolvePatientFirstName(supabase, appt.tenantId, appt.patientId, patientNameHint),
  ])

  const start = new Date(appt.appointmentAt)
  const end = new Date(start.getTime() + details.durationMinutes * 60_000)
  const calendarId = auth.connection.config.calendar_id || 'primary'

  try {
    const eventId = await createCalendarEvent(auth.accessToken, calendarId, {
      summary: `Consulta — ${patientName || 'Paciente'}`,
      description: [
        details.procedureName ? `Procedimento: ${details.procedureName}` : null,
        doctor.doctorName ? `Profissional: ${doctor.doctorName}` : null,
        'Agendado pelo Clinni.',
      ]
        .filter(Boolean)
        .join('\n'),
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      timeZone: details.timeZone,
    })
    await recordSync(supabase, {
      appointmentId: appt.id,
      tenantId: appt.tenantId,
      userId: doctor.userId,
      calendarId,
      eventId,
      status: 'synced',
    })
  } catch (err) {
    logger.error(
      { err: (err as Error).message, appointmentId: appt.id },
      'google-calendar-create-failed',
    )
    await recordSync(supabase, {
      appointmentId: appt.id,
      tenantId: appt.tenantId,
      userId: doctor.userId,
      calendarId,
      eventId: null,
      status: 'failed',
      error: (err as Error).message,
    })
  }
}

async function onReversed(
  supabase: SupabaseClient<Database>,
  appointmentId: string,
  tenantId: string,
): Promise<void> {
  const { data } = await loose(supabase)
    .from('appointment_calendar_sync')
    .select('user_id, calendar_id, external_event_id, status')
    .eq('appointment_id', appointmentId)
    .eq('provider', PROVIDER)
    .maybeSingle()
  const row = data as {
    user_id: string | null
    calendar_id: string | null
    external_event_id: string | null
    status: string
  } | null
  if (!row || row.status === 'deleted' || !row.external_event_id || !row.user_id) return

  const auth = await withGoogleAuth(supabase, row.user_id, tenantId)
  if (auth.kind !== 'connected') return

  try {
    await deleteCalendarEvent(auth.accessToken, row.calendar_id || 'primary', row.external_event_id)
    await loose(supabase)
      .from('appointment_calendar_sync')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('appointment_id', appointmentId)
      .eq('provider', PROVIDER)
  } catch (err) {
    logger.error({ err: (err as Error).message, appointmentId }, 'google-calendar-delete-failed')
  }
}

/**
 * Remove o evento do Google de um atendimento (cancelamento/estorno). Best-effort,
 * nunca lança. Chamado pelas rotas de cancelar/estornar — não há evento de domínio
 * `appointment.reversed` publicado, então o caller aciona direto.
 */
export async function removeAppointmentFromGoogle(
  supabase: SupabaseClient<Database>,
  appointmentId: string,
  tenantId: string,
): Promise<void> {
  try {
    await onReversed(supabase, appointmentId, tenantId)
  } catch (err) {
    logger.error({ err: (err as Error).message, appointmentId }, 'google-calendar-remove-failed')
  }
}

/** Hook único, chamado pelo publishDomainEvent. Best-effort, nunca lança. */
export async function syncDomainEventToGoogle(
  supabase: SupabaseClient<Database>,
  event: DomainEvent,
): Promise<void> {
  try {
    if (event.type === 'appointment.created') {
      await onCreated(supabase, event.appointment, event.patient.fullName)
    } else if (event.type === 'appointment.reversed') {
      await onReversed(supabase, event.original.id, event.original.tenantId)
    }
  } catch (err) {
    logger.error({ err: (err as Error).message, type: event.type }, 'google-calendar-sync-failed')
  }
}
