/**
 * Feature 018 — Histórico de envios + listagem de próximos lembretes.
 *
 * Funções server-side usadas pela UI admin (US3):
 *   - listRemindersHistory: registros passados paginados
 *   - listUpcomingReminders: preview dos próximos N agendamentos elegíveis
 *     nas próximas 24h (somente preview — não cria nada)
 *
 * Multi-tenant: filtro tenant_id explícito em todas as queries (Princípio III).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface HistoryRow {
  id: string
  appointmentId: string
  appointmentAt: string
  patientFullName: string
  doctorFullName: string
  procedureName: string
  status: string
  error: string | null
  isManual: boolean
  scheduledOffsetHours: number
  channel: string
  createdAt: string
  sentAt: string | null
}

export interface ListHistoryInput {
  tenantId: string
  limit?: number
  offset?: number
}

/**
 * Lista os últimos N envios para o tenant. JOIN com appointments + doctors +
 * procedures para mostrar dados "vivos" (Q4) na tabela.
 * Paciente nome NÃO aparece (mantém PII fora da tela; admin clica no
 * appointment para ver detalhes do paciente — UX comum em healthcare SaaS).
 */
export async function listRemindersHistory(
  supabase: SupabaseClient<Database>,
  input: ListHistoryInput,
): Promise<HistoryRow[]> {
  const limit = input.limit ?? 20
  const offset = input.offset ?? 0
  // appointment_reminders ainda não está nos tipos Database gerados
  // (T009 supabase:gen-types pendente Docker). Cast controlado.
  const client = supabase as unknown as SupabaseClient
  const { data, error } = await client
    .from('appointment_reminders')
    .select(
      `id, appointment_id, scheduled_offset_hours, channel, status, error,
       is_manual, created_at, sent_at,
       appointments!inner(appointment_at, doctor_id, procedure_id,
         doctors!inner(full_name),
         procedures!inner(display_name, tuss_code))`,
    )
    .eq('tenant_id', input.tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) {
    throw new Error(`listRemindersHistory failed: ${error.message}`)
  }
  const rows = (data ?? []) as unknown as Array<{
    id: string
    appointment_id: string
    scheduled_offset_hours: number
    channel: string
    status: string
    error: string | null
    is_manual: boolean
    created_at: string
    sent_at: string | null
    appointments: {
      appointment_at: string
      doctor_id: string
      procedure_id: string
      doctors: { full_name: string } | null
      procedures: { display_name: string | null; tuss_code: string | null } | null
    } | null
  }>
  return rows.map((r) => ({
    id: r.id,
    appointmentId: r.appointment_id,
    appointmentAt: r.appointments?.appointment_at ?? '',
    patientFullName: '', // omitido — PII; admin abre appointment para ver
    doctorFullName: r.appointments?.doctors?.full_name ?? '—',
    procedureName:
      r.appointments?.procedures?.display_name ?? r.appointments?.procedures?.tuss_code ?? '—',
    status: r.status,
    error: r.error,
    isManual: r.is_manual,
    scheduledOffsetHours: r.scheduled_offset_hours,
    channel: r.channel,
    createdAt: r.created_at,
    sentAt: r.sent_at,
  }))
}
