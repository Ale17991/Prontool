import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError } from '@/lib/observability/errors'

export interface CreatePerioExamInput {
  tenantId: string
  patientId: string
  dentition?: 'permanent' | 'deciduous'
  examDate?: string | null
  appointmentId?: string | null
  notes?: string | null
  actorUserId: string
}

/**
 * Cria um exame periodontal em rascunho. O índice único parcial garante no
 * máximo um rascunho por paciente — colisão vira erro `DRAFT_EXISTS`.
 */
export async function createPerioExam(
  supabase: SupabaseClient<Database>,
  input: CreatePerioExamInput,
): Promise<{ id: string }> {
  const res = await supabase
    .from('perio_exams')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      dentition: input.dentition ?? 'permanent',
      ...(input.examDate ? { exam_date: input.examDate } : {}),
      appointment_id: input.appointmentId ?? null,
      notes: input.notes?.trim() || null,
      created_by: input.actorUserId,
    })
    .select('id')
    .single()

  if (res.error || !res.data) {
    if (res.error?.code === '23505') {
      throw new ConflictError(
        'DRAFT_EXISTS',
        'Já existe um exame periodontal em rascunho para este paciente. Finalize ou descarte antes de criar outro.',
      )
    }
    throw new Error(`createPerioExam failed: ${res.error?.message}`)
  }
  return { id: res.data.id }
}
