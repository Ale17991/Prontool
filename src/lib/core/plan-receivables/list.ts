import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export type ReceiptStatus = 'pendente' | 'recebido' | 'glosado' | 'nao_recebido'

export interface PlanReceivableRow {
  /** id da linha de appointment_procedures (unidade da marcação). */
  procedureLineId: string
  appointmentId: string
  appointmentAt: string
  planId: string
  planName: string
  procedureLabel: string
  doctorName: string
  patientName: string
  amountCents: number
  status: ReceiptStatus
  receivedAt: string | null
}

export interface ListPlanReceivablesInput {
  tenantId: string
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  planId?: string | null
  /** Filtra por profissional (doctor_id) do atendimento. */
  doctorId?: string | null
  status?: ReceiptStatus | 'all'
  /** Busca textual (paciente / procedimento / profissional / convênio). */
  search?: string | null
  /** Para decifrar o nome do paciente (RPC). Sem chave → '—'. */
  encryptionKey?: string
}

const MAX_APPTS = 3000

/** Normaliza para busca: minúsculas, sem acento, sem espaços nas pontas. */
function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Lista as linhas de procedimento de convênio (plan_id não nulo) de
 * atendimentos ATIVOS no período, com o status de recebimento da operadora.
 * Ausência de linha em plan_procedure_receipts = 'pendente'.
 */
export async function listPlanReceivables(
  supabase: SupabaseClient<Database>,
  input: ListPlanReceivablesInput,
): Promise<PlanReceivableRow[]> {
  const fromIso = new Date(`${input.from}T00:00:00`).toISOString()
  const toIso = new Date(`${input.to}T23:59:59.999`).toISOString()

  // 1) Atendimentos ativos no período.
  const apptRes = await supabase
    .from('appointments_effective')
    .select('id, appointment_at, doctor_id, patient_id, effective_status')
    .eq('tenant_id', input.tenantId)
    .eq('effective_status', 'ativo')
    .gte('appointment_at', fromIso)
    .lte('appointment_at', toIso)
    .order('appointment_at', { ascending: false })
    .limit(MAX_APPTS)
  if (apptRes.error) throw new Error(`listPlanReceivables appts: ${apptRes.error.message}`)
  const appts = (apptRes.data ?? []) as unknown as Array<{
    id: string
    appointment_at: string
    doctor_id: string
    patient_id: string
  }>
  if (appts.length === 0) return []

  // Filtro por profissional já aqui (reduz as buscas seguintes).
  const scopedAppts = input.doctorId ? appts.filter((a) => a.doctor_id === input.doctorId) : appts
  if (scopedAppts.length === 0) return []

  const apptById = new Map(scopedAppts.map((a) => [a.id, a]))
  const apptIds = scopedAppts.map((a) => a.id)

  // 2) Linhas de procedimento de convênio desses atendimentos.
  const lineRows: Array<{
    id: string
    appointment_id: string
    plan_id: string | null
    line_amount_cents: number
    quantity: number
    procedures: { tuss_code: string | null; display_name: string | null } | null
    health_plans: { name: string } | null
  }> = []
  const CHUNK = 200
  for (let i = 0; i < apptIds.length; i += CHUNK) {
    const ids = apptIds.slice(i, i + CHUNK)
    const r = await supabase
      .from('appointment_procedures')
      .select(
        'id, appointment_id, plan_id, line_amount_cents, quantity, procedures:procedure_id(tuss_code, display_name), health_plans:plan_id(name)',
      )
      .eq('tenant_id', input.tenantId)
      .not('plan_id', 'is', null)
      .in('appointment_id', ids)
    if (r.error) throw new Error(`listPlanReceivables lines: ${r.error.message}`)
    lineRows.push(...((r.data ?? []) as unknown as typeof lineRows))
  }
  if (input.planId) {
    for (let i = lineRows.length - 1; i >= 0; i--) {
      if (lineRows[i]!.plan_id !== input.planId) lineRows.splice(i, 1)
    }
  }
  if (lineRows.length === 0) return []

  // 3) Status de recebimento por linha.
  const statusByLine = new Map<string, { status: ReceiptStatus; received_at: string | null }>()
  const lineIds = lineRows.map((l) => l.id)
  for (let i = 0; i < lineIds.length; i += CHUNK) {
    const ids = lineIds.slice(i, i + CHUNK)
    const r = await supabase
      .from('plan_procedure_receipts' as never)
      .select('appointment_procedure_id, status, received_at')
      .eq('tenant_id', input.tenantId)
      .in('appointment_procedure_id', ids)
    if (r.error) throw new Error(`listPlanReceivables status: ${r.error.message}`)
    for (const row of (r.data ?? []) as unknown as Array<{
      appointment_procedure_id: string
      status: ReceiptStatus
      received_at: string | null
    }>) {
      statusByLine.set(row.appointment_procedure_id, {
        status: row.status,
        received_at: row.received_at,
      })
    }
  }

  // 4) Médicos.
  const doctorIds = Array.from(new Set(scopedAppts.map((a) => a.doctor_id)))
  const doctorNames = new Map<string, string>()
  if (doctorIds.length > 0) {
    const r = await supabase
      .from('doctors')
      .select('id, full_name')
      .eq('tenant_id', input.tenantId)
      .in('id', doctorIds)
    for (const d of (r.data ?? []) as Array<{ id: string; full_name: string }>) {
      doctorNames.set(d.id, d.full_name)
    }
  }

  // 5) Pacientes (decifra nomes).
  const patientNames = new Map<string, string>()
  if (input.encryptionKey) {
    const patientIds = Array.from(new Set(scopedAppts.map((a) => a.patient_id)))
    if (patientIds.length > 0) {
      const r = await supabase.rpc('decrypt_patient_names_for_ids' as never, {
        p_tenant_id: input.tenantId,
        p_patient_ids: patientIds,
        p_key: input.encryptionKey,
      } as never)
      for (const p of (r.data ?? []) as Array<{
        id: string
        full_name: string | null
        anonymized_at: string | null
      }>) {
        patientNames.set(p.id, p.anonymized_at ? '[anonimizado]' : p.full_name || '—')
      }
    }
  }

  // 6) Monta linhas + aplica filtros de status e busca textual.
  const query = input.search ? normalizeForSearch(input.search) : null
  const out: PlanReceivableRow[] = []
  for (const l of lineRows) {
    const appt = apptById.get(l.appointment_id)
    if (!appt) continue
    const st = statusByLine.get(l.id)
    const status: ReceiptStatus = st?.status ?? 'pendente'
    if (input.status && input.status !== 'all' && status !== input.status) continue

    const planName = l.health_plans?.name ?? 'Convênio'
    const procedureLabel = l.procedures?.display_name?.trim() || l.procedures?.tuss_code || '—'
    const doctorName = doctorNames.get(appt.doctor_id) ?? '—'
    const patientName = patientNames.get(appt.patient_id) ?? '—'

    if (query) {
      const haystack = normalizeForSearch(
        `${patientName} ${procedureLabel} ${doctorName} ${planName}`,
      )
      if (!haystack.includes(query)) continue
    }

    out.push({
      procedureLineId: l.id,
      appointmentId: l.appointment_id,
      appointmentAt: appt.appointment_at,
      planId: l.plan_id as string,
      planName,
      procedureLabel,
      doctorName,
      patientName,
      amountCents: Number(l.line_amount_cents) * Number(l.quantity ?? 1),
      status,
      receivedAt: st?.received_at ?? null,
    })
  }
  return out
}
