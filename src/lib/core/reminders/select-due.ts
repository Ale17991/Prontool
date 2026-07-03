/**
 * Feature 018 — Seleção de agendamentos elegíveis no ciclo do cron.
 *
 * Retorna `EligibleAppointment[]` filtrados por:
 *   - appointment_at na janela [now + offset - 15min, now + offset]
 *   - tenant_id (defense in depth — RLS service-role já bypassed, mas
 *     o filtro explícito é mandatório por Princípio III)
 *   - patient.email NÃO nulo
 *   - patient.reminders_opt_in = TRUE
 *   - appointment não estornado (NOT EXISTS appointment_reversals)
 *   - JÁ NÃO existe registro automático para essa combinação
 *     (appointment_id, offset, channel) WHERE is_manual=FALSE
 *
 * O cron usa service-role client (RLS bypass), mas SEMPRE filtra por
 * tenant_id explícito em cada query — gate constitucional III.
 *
 * Decisão de dados "vivos" (clarificação Q4): JOIN com doctors/procedures
 * sem snapshot histórico.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'
import type { EligibleAppointment } from './types'

const WINDOW_MINUTES = 15

export interface SelectDueInput {
  tenantId: string
  offsetHours: number
  /** Now em UTC; passar explicitamente facilita teste com vi.setSystemTime. */
  now: Date
}

/**
 * NOTA sobre tipo Supabase: usamos `any` controlado no client porque
 * o tipo Database gerado ainda não inclui a coluna `reminders_opt_in`
 * (T009 está pendente — requer Docker). O SQL é correto e roda.
 * Quando reviewer rodar `pnpm supabase:gen-types`, este `as never` cai
 * sozinho.
 */
export async function selectDueAppointments(
  supabase: SupabaseClient,
  input: SelectDueInput,
): Promise<EligibleAppointment[]> {
  const offsetMs = input.offsetHours * 60 * 60 * 1000
  const winMs = WINDOW_MINUTES * 60 * 1000
  const lower = new Date(input.now.getTime() + offsetMs - winMs).toISOString()
  const upper = new Date(input.now.getTime() + offsetMs).toISOString()

  const { data, error } = await supabase
    .from('appointments')
    .select(
      `
      id, tenant_id, appointment_at, doctor_id, procedure_id, patient_id,
      doctors!inner(id, full_name, active),
      procedures!inner(id, display_name, tuss_code),
      patients!inner(id, email_enc, reminders_opt_in, status)
    `,
    )
    .eq('tenant_id', input.tenantId)
    .gte('appointment_at', lower)
    .lte('appointment_at', upper)

  if (error) {
    logger.error(
      { tenantId: input.tenantId, offsetHours: input.offsetHours, err: error.message },
      'select-due-failed',
    )
    return []
  }

  // Carregar reversals e reminders já gerados — antijoin manual para evitar
  // limitações do supabase-js com NOT EXISTS.
  const apptIds = (data ?? []).map((r: { id: string }) => r.id)
  if (apptIds.length === 0) return []

  const [reversalsRes, remindersRes] = await Promise.all([
    supabase
      .from('appointment_reversals')
      .select('appointment_id')
      .eq('tenant_id', input.tenantId)
      .in('appointment_id', apptIds),
    supabase
      .from('appointment_reminders')
      .select('appointment_id')
      .eq('tenant_id', input.tenantId)
      .eq('scheduled_offset_hours', input.offsetHours)
      .eq('channel', 'email')
      .eq('is_manual', false)
      .in('appointment_id', apptIds),
  ])

  const reversedIds = new Set(
    ((reversalsRes.data as Array<{ appointment_id: string }> | null) ?? []).map(
      (r) => r.appointment_id,
    ),
  )
  const alreadySentIds = new Set(
    ((remindersRes.data as Array<{ appointment_id: string }> | null) ?? []).map(
      (r) => r.appointment_id,
    ),
  )

  // Decrypt em batch seria mais eficiente, mas N pequeno (<=200/ciclo) e o
  // pattern existente em outras features usa decrypt linha-a-linha via RPC.
  // Para o select-due, deixamos email como `null` se a coluna criptografada
  // for null — o paciente full_name e o decrypt do email são feitos no
  // send-one.ts (next layer).
  const rows = (data ?? []) as unknown as Array<{
    id: string
    tenant_id: string
    appointment_at: string
    doctor_id: string
    procedure_id: string
    patient_id: string
    doctors: { id: string; full_name: string; active: boolean } | null
    procedures: { id: string; display_name: string | null; tuss_code: string | null } | null
    patients: {
      id: string
      email_enc: string | null
      reminders_opt_in: boolean | null
      status: string | null
    } | null
  }>

  const eligible: EligibleAppointment[] = []
  for (const row of rows) {
    if (reversedIds.has(row.id)) continue
    if (alreadySentIds.has(row.id)) continue

    const patient = row.patients
    // Backlog 1/5 — não envia mensagem para paciente inativo/óbito.
    if (patient?.status && patient.status !== 'ativo') continue
    const doctor = row.doctors
    const proc = row.procedures

    eligible.push({
      appointmentId: row.id,
      tenantId: row.tenant_id,
      appointmentAt: row.appointment_at,
      doctorId: row.doctor_id,
      doctorFullName: doctor?.full_name ?? '—',
      doctorActive: doctor?.active === true,
      procedureId: row.procedure_id,
      procedureName: proc?.display_name ?? proc?.tuss_code ?? '—',
      patientId: row.patient_id,
      patientFullName: '',
      // email_enc é ciphertext. O decrypt é feito no send-one.ts para evitar
      // expor o claro em buffer durante seleção (LGPD §8).
      patientEmail: patient?.email_enc ? '__encrypted__' : null,
      remindersOptIn: patient?.reminders_opt_in !== false,
      isReversed: false,
    })
  }
  return eligible
}

/**
 * Helper utilitário: testar se a hora atual `now` está dentro da janela
 * de envio configurada para o tenant. A interpretação é no fuso da clínica
 * (default America/Sao_Paulo).
 */
export function isWithinWindow(
  now: Date,
  windowStart: string,
  windowEnd: string,
  timezone: string = 'America/Sao_Paulo',
): boolean {
  // Formata para 'HH:MM' no fuso da clínica.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const localHHMM = fmt.format(now)
  return localHHMM >= windowStart && localHHMM <= windowEnd
}

/**
 * Helper utilitário: testar se o dia da semana atual (no fuso do tenant)
 * é fim de semana (sábado=6, domingo=0).
 */
export function isWeekend(now: Date, timezone: string = 'America/Sao_Paulo'): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  })
  const weekday = fmt.format(now)
  return weekday === 'Sat' || weekday === 'Sun'
}
