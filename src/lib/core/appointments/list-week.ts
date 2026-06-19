import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DEFAULT_DURATION_MINUTES } from '@/lib/utils/calendar'

/**
 * Carrega atendimentos para a janela [weekStart, weekEnd] de um tenant,
 * usado pela visualizacao Calendario (feature 004 / US1).
 *
 * - Le `appointments_effective` (RLS por tenant ja em vigor).
 * - Faz join com `doctors` e `procedures` em uma unica query.
 * - Descriptografa nomes de paciente em batch via RPC.
 * - Aplica COALESCE para `duration_minutes` -> 30 (default na leitura, nao no banco).
 */
export interface ListWeekInput {
  tenantId: string
  weekStart: Date
  weekEnd: Date
  doctorIds?: string[]
}

export interface AppointmentWeekRow {
  id: string
  patientId: string
  patientName: string
  doctorId: string
  doctorName: string
  procedureId: string
  procedureLabel: string
  appointmentAt: string
  durationMinutes: number
  effectiveStatus: 'agendado' | 'ativo' | 'cancelado' | 'estornado'
  /** Null = atendimento particular. */
  planId: string | null
  /** Quantidade de profissionais assistentes ativos. Feature 013 US2. */
  assistantsCount: number
  /** Backlog 1/6 — atendimento de retorno. */
  isReturn: boolean
}

interface RawRow {
  id: string | null
  patient_id: string | null
  doctor_id: string | null
  procedure_id: string | null
  plan_id: string | null
  appointment_at: string | null
  duration_minutes: number | null
  effective_status: string | null
  is_return: boolean | null
  doctors: { full_name: string | null } | null
  procedures: { tuss_code: string | null; display_name: string | null } | null
}

const SELECT_WITH_DURATION =
  'id, patient_id, doctor_id, procedure_id, plan_id, appointment_at, duration_minutes, effective_status, is_return, ' +
  'doctors:doctor_id(full_name), ' +
  'procedures:procedure_id(tuss_code, display_name)'

const SELECT_WITHOUT_DURATION =
  'id, patient_id, doctor_id, procedure_id, plan_id, appointment_at, effective_status, is_return, ' +
  'doctors:doctor_id(full_name), ' +
  'procedures:procedure_id(tuss_code, display_name)'

/**
 * Teto duro de linhas retornadas. Subido de 500 -> 5000 porque clinicas
 * movimentadas em mes-view (35 dias × varios profissionais) ultrapassavam
 * 500 e a query (sorted ASC) truncava o FINAL do periodo — exatamente o
 * sintoma "ultimos dias do filtro aparecem vazios". A UI checa
 * appointments.length >= APPOINTMENT_WEEK_ROW_LIMIT e mostra aviso.
 */
export const APPOINTMENT_WEEK_ROW_LIMIT = 5000

export async function listAppointmentsForWeek(
  supabase: SupabaseClient<Database>,
  input: ListWeekInput,
  options?: {
    /** Service-role client para descriptografar nomes; opcional. */
    serviceClient?: SupabaseClient<Database>
    /** Chave de descriptografia. Se ausente, retorna patientName='—'. */
    encryptionKey?: string
  },
): Promise<AppointmentWeekRow[]> {
  // Tenta a forma completa (com duration_minutes). Se a migration 0053 nao
  // foi aplicada no ambiente atual, a coluna nao existe — caimos no SELECT
  // alternativo e cada linha cai no DEFAULT_DURATION_MINUTES.
  async function runQuery(select: string) {
    let q = supabase
      .from('appointments_effective')
      .select(select)
      .eq('tenant_id', input.tenantId)
      .gte('appointment_at', input.weekStart.toISOString())
      .lte('appointment_at', input.weekEnd.toISOString())
      .order('appointment_at', { ascending: true })
      .limit(APPOINTMENT_WEEK_ROW_LIMIT)
    if (input.doctorIds && input.doctorIds.length > 0) {
      q = q.in('doctor_id', input.doctorIds)
    }
    return q
  }

  let result = await runQuery(SELECT_WITH_DURATION)
  if (result.error && isMissingColumnError(result.error.message, 'duration_minutes')) {
    result = await runQuery(SELECT_WITHOUT_DURATION)
  }
  if (result.error) throw new Error(`appointments week fetch failed: ${result.error.message}`)
  const rows = (result.data ?? []) as unknown as RawRow[]
  if (rows.length === 0) return []
  if (rows.length >= APPOINTMENT_WEEK_ROW_LIMIT) {
    // Sinaliza ao operador: a UI cuida do banner amarelo, mas log permite
    // alertar ops antes do usuario perceber.
    console.warn(
      `[list-week] row limit ${APPOINTMENT_WEEK_ROW_LIMIT} atingido para tenant=${input.tenantId} range=${input.weekStart.toISOString()}..${input.weekEnd.toISOString()}; resultado truncado`,
    )
  }

  // Descriptografia de nomes em batch (mesmo padrao da pagina Lista).
  const patientNames = new Map<string, string>()
  const patientIds = Array.from(
    new Set(rows.map((r) => r.patient_id).filter((id): id is string => Boolean(id))),
  )
  if (options?.serviceClient && options?.encryptionKey && patientIds.length > 0) {
    const rpc = await options.serviceClient.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: input.tenantId,
      p_patient_ids: patientIds,
      p_key: options.encryptionKey,
    })
    type DecryptRow = { id: string; full_name: string | null; anonymized_at: string | null }
    for (const p of (rpc.data ?? []) as DecryptRow[]) {
      patientNames.set(p.id, p.anonymized_at ? '[anonimizado]' : p.full_name ?? '—')
    }
  }

  // Conta assistentes ativos por appointment_id em batch (feature 013).
  const assistantsByAppointment = new Map<string, number>()
  const apptIdsForAssist = rows
    .map((r) => r.id)
    .filter((v): v is string => typeof v === 'string')
  if (apptIdsForAssist.length > 0) {
    try {
      const { data: assistantRows } = await supabase
        .from('appointment_assistants' as never)
        .select('appointment_id')
        .in('appointment_id', apptIdsForAssist)
        .is('removed_at', null)
      for (const r of (assistantRows ?? []) as Array<{ appointment_id: string }>) {
        assistantsByAppointment.set(
          r.appointment_id,
          (assistantsByAppointment.get(r.appointment_id) ?? 0) + 1,
        )
      }
    } catch {
      // best-effort — feature 013 ainda nao aplicada
    }
  }

  return rows
    .filter((r) => r.id && r.appointment_at && r.doctor_id && r.procedure_id && r.patient_id)
    .map<AppointmentWeekRow>((r) => {
      const at = r.appointment_at as string
      // Fallback de seguranca: ambientes que ainda nao receberam a migration
      // 0054 (view com clausula 'agendado') retornam apenas ativo|estornado.
      // Calculamos 'agendado' aqui pelo timestamp para que a UI funcione em
      // qualquer estado da migration.
      // Preserva os status terminais da view (estornado/cancelado) em vez de
      // colapsar tudo que não é estornado em 'ativo' — senão um atendimento
      // CANCELADO aparecia como "Realizado" no calendário (divergindo do detalhe).
      const status: AppointmentWeekRow['effectiveStatus'] =
        r.effective_status === 'estornado'
          ? 'estornado'
          : r.effective_status === 'cancelado'
            ? 'cancelado'
            : r.effective_status === 'agendado' || new Date(at).getTime() > Date.now()
              ? 'agendado'
              : 'ativo'
      return {
        id: r.id as string,
        patientId: r.patient_id as string,
        patientName: patientNames.get(r.patient_id as string) ?? '—',
        doctorId: r.doctor_id as string,
        doctorName: r.doctors?.full_name ?? '—',
        procedureId: r.procedure_id as string,
        procedureLabel:
          r.procedures?.display_name?.trim() || r.procedures?.tuss_code || '—',
        appointmentAt: at,
        durationMinutes: r.duration_minutes ?? DEFAULT_DURATION_MINUTES,
        effectiveStatus: status,
        planId: r.plan_id,
        assistantsCount: assistantsByAppointment.get(r.id as string) ?? 0,
        isReturn: r.is_return === true,
      }
    })
}

/**
 * Reconhece os erros do PostgREST/Postgres quando uma coluna nao existe.
 * Cobre tanto o JSON parsing error code 42703 quanto a mensagem textual
 * "column ... does not exist".
 */
function isMissingColumnError(message: string, column: string): boolean {
  if (!message) return false
  const lower = message.toLowerCase()
  return (
    lower.includes(`column ${column.toLowerCase()}`) ||
    lower.includes(`"${column.toLowerCase()}" does not exist`) ||
    (lower.includes(column.toLowerCase()) && lower.includes('does not exist'))
  )
}
