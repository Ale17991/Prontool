import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import {
  assertValidSurface,
  assertValidTooth,
  isValidSurface,
  isValidTooth,
  type Surface,
} from '@/lib/core/dental/teeth'

export interface ChartEntryDTO {
  id: string
  toothFdi: number
  surface: Surface | null
  statusId: string
  statusCode: string
  note: string | null
  recordedAt: string
  appointmentId: string | null
  createdBy: string
}

export interface CreateChartEntryInput {
  tenantId: string
  patientId: string
  toothFdi: number
  surface?: Surface | null
  statusId: string
  note?: string | null
  appointmentId?: string | null
  actorUserId: string
}

interface DbRow {
  id: string
  tooth_fdi: number
  surface: string | null
  status_id: string
  note: string | null
  recorded_at: string
  appointment_id: string | null
  created_by: string
}

/**
 * Cria uma marcação odontográfica (append-only). "Limpar" = enviar o statusId
 * do status `none`. Valida o dente/face e a coerência escopo↔surface contra o
 * status do catálogo (o banco também garante — defesa em camadas).
 */
export async function createChartEntry(
  supabase: SupabaseClient<Database>,
  input: CreateChartEntryInput,
): Promise<ChartEntryDTO> {
  // Validação de posição.
  if (!isValidTooth(input.toothFdi)) {
    throw new ValidationError('Dente FDI inválido', { tooth_fdi: input.toothFdi })
  }
  const surface = input.surface ?? null
  if (surface !== null && !isValidSurface(surface)) {
    throw new ValidationError('Face inválida', { surface })
  }

  // Paciente pertence ao tenant.
  const pat = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .maybeSingle()
  if (pat.error) throw new Error(`patient lookup: ${pat.error.message}`)
  if (!pat.data) throw new NotFoundError('patient', input.patientId)

  // Status do catálogo (escopo + code).
  const status = await supabase
    .from('dental_status_catalog')
    .select('id, code, scope, is_active')
    .eq('id', input.statusId)
    .maybeSingle()
  if (status.error) throw new Error(`status lookup: ${status.error.message}`)
  if (!status.data) throw new NotFoundError('dental_status', input.statusId)
  if (!status.data.is_active) {
    throw new ValidationError('Status desativado não pode ser aplicado', {
      status_id: input.statusId,
    })
  }

  // Coerência escopo↔surface.
  const scope = status.data.scope as 'tooth' | 'face' | 'both'
  if (scope === 'tooth' && surface !== null) {
    throw new ValidationError('Status de escopo dente não aceita face', { scope })
  }
  if (scope === 'face' && surface === null) {
    throw new ValidationError('Status de escopo face exige uma face', { scope })
  }

  const { data, error } = await supabase
    .from('dental_chart_entries')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      appointment_id: input.appointmentId ?? null,
      tooth_fdi: input.toothFdi,
      surface,
      status_id: input.statusId,
      note: input.note?.trim() || null,
      created_by: input.actorUserId,
    })
    .select('id, tooth_fdi, surface, status_id, note, recorded_at, appointment_id, created_by')
    .single()
  if (error || !data) throw new Error(`createChartEntry failed: ${error?.message}`)

  return toDto(data as DbRow, status.data.code)
}

function toDto(r: DbRow, statusCode: string): ChartEntryDTO {
  if (r.surface !== null) assertValidSurface(r.surface)
  assertValidTooth(r.tooth_fdi)
  return {
    id: r.id,
    toothFdi: r.tooth_fdi,
    surface: (r.surface as Surface | null) ?? null,
    statusId: r.status_id,
    statusCode,
    note: r.note,
    recordedAt: r.recorded_at,
    appointmentId: r.appointment_id,
    createdBy: r.created_by,
  }
}
