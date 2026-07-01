import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'
import type { ConflictWarning, CreateScheduleBlockInput, CreateScheduleBlockResult } from './types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Cria um bloqueio de agenda. Validacoes:
 *   - block_date YYYY-MM-DD
 *   - all_day=true => start/end devem ser null
 *   - all_day=false => start/end HH:MM obrigatorios + end > start
 *   - reason min 2 chars (alinha com CHECK)
 *   - doctor pertence ao tenant
 *
 * Retorna lista de atendimentos sobrepostos no horario (warning, nao
 * impede). O caller pode usar essa lista para confirmar visualmente.
 */
export async function createScheduleBlock(
  supabase: SupabaseClient<Database>,
  input: CreateScheduleBlockInput,
): Promise<CreateScheduleBlockResult> {
  if (!DATE_RE.test(input.blockDate)) {
    throw new DomainError('INVALID_DATE', 'Data deve estar em YYYY-MM-DD', { status: 400 })
  }
  if (input.reason.trim().length < 2) {
    throw new DomainError('REASON_TOO_SHORT', 'Motivo do bloqueio é obrigatório.', {
      status: 400,
    })
  }

  let startTime: string | null = null
  let endTime: string | null = null
  if (input.allDay) {
    if (input.startTime || input.endTime) {
      throw new DomainError('INVALID_TIMES', 'Bloqueio de dia inteiro não deve ter horários.', {
        status: 400,
      })
    }
  } else {
    const s = input.startTime?.trim() ?? ''
    const e = input.endTime?.trim() ?? ''
    if (!TIME_RE.test(s) || !TIME_RE.test(e)) {
      throw new DomainError(
        'INVALID_TIMES',
        'Horários de início e fim são obrigatórios (HH:MM) quando não é dia inteiro.',
        { status: 400 },
      )
    }
    if (e <= s) {
      throw new DomainError('INVALID_TIMES', 'Horário de fim deve ser depois do início.', {
        status: 400,
      })
    }
    startTime = s
    endTime = e
  }

  // Doctor existe no tenant.
  const doctor = await supabase
    .from('doctors')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.doctorId)
    .maybeSingle()
  if (doctor.error) throw new Error(`doctor lookup: ${doctor.error.message}`)
  if (!doctor.data) throw new NotFoundError('doctor', input.doctorId)

  // Detecta sobreposicao com atendimentos ativos no mesmo doctor e dia.
  const conflicts = await detectAppointmentConflicts(supabase, {
    tenantId: input.tenantId,
    doctorId: input.doctorId,
    blockDate: input.blockDate,
    allDay: input.allDay,
    startTime,
    endTime,
  })

  const insertPayload: Record<string, unknown> = {
    tenant_id: input.tenantId,
    doctor_id: input.doctorId,
    block_date: input.blockDate,
    start_time: startTime,
    end_time: endTime,
    all_day: input.allDay,
    reason: input.reason.trim(),
    created_by: input.actorUserId,
  }

  const ins = (await supabase
    .from('schedule_blocks' as never)
    .insert(insertPayload as never)
    .select('id')
    .single()) as { data: { id: string } | null; error: { message: string } | null }
  if (ins.error || !ins.data) {
    throw new Error(`createScheduleBlock failed: ${ins.error?.message ?? 'unknown'}`)
  }

  return {
    id: ins.data.id,
    conflicts,
  }
}

async function detectAppointmentConflicts(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    doctorId: string
    blockDate: string
    allDay: boolean
    startTime: string | null
    endTime: string | null
  },
): Promise<ConflictWarning[]> {
  // Janela [from, to) em UTC. Para 'dia inteiro' = dia todo do calendar
  // server-side. Sem timezone-aware aqui — bom-o-suficiente para warning;
  // a verificacao real continua sendo client + slot_locks ao agendar.
  const dayStartIso = `${args.blockDate}T00:00:00.000Z`
  const dayEndIso = nextDayIso(args.blockDate)
  const fromIso = args.allDay ? dayStartIso : `${args.blockDate}T${args.startTime}:00.000Z`
  const toIso = args.allDay ? dayEndIso : `${args.blockDate}T${args.endTime}:00.000Z`

  const res = await supabase
    .from('appointments_effective')
    .select('id, appointment_at, duration_minutes, patient_id, effective_status')
    .eq('tenant_id', args.tenantId)
    .eq('doctor_id', args.doctorId)
    .gte('appointment_at', dayStartIso)
    .lt('appointment_at', dayEndIso)
    .limit(50)
  if (res.error) {
    // best-effort: warning silencioso, nao quebra criacao
    return []
  }

  type Row = {
    id: string
    appointment_at: string
    duration_minutes: number | null
    patient_id: string
    effective_status: string | null
  }
  const rows = (res.data ?? []) as unknown as Row[]
  const fromMs = new Date(fromIso).getTime()
  const toMs = new Date(toIso).getTime()

  const overlapping = rows.filter((r) => {
    if (r.effective_status === 'estornado') return false
    const start = new Date(r.appointment_at).getTime()
    const end = start + (r.duration_minutes ?? 30) * 60_000
    return start < toMs && end > fromMs
  })

  if (overlapping.length === 0) return []

  // Nomes ficam '—' aqui — UI mostra so a contagem. Buscar nomes envolveria
  // service_role + decrypt + chave; deixamos pro UI consultar separadamente
  // se quiser detalhe.
  return overlapping.map((r) => ({
    appointmentId: r.id,
    patientName: '—',
    appointmentAt: r.appointment_at,
  }))
}

function nextDayIso(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}
