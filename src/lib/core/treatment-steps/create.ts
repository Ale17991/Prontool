import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

export interface CreateTreatmentStepInput {
  tenantId: string
  patientId: string
  procedureId: string
  doctorId: string
  healthPlanId?: string | null
  title: string
  notes?: string | null
  scheduledDate?: string | null // YYYY-MM-DD
  /** Posição odontológica (feature 040). Null para etapas não-odonto. */
  toothFdi?: number | null
  surface?: string | null
  actorUserId: string
}

export interface CreateTreatmentStepResult {
  id: string
}

/**
 * Cria uma etapa de tratamento direta no paciente (sem plano agregador,
 * após migration 0035). Valida que paciente + procedimento + plano de
 * saúde (se informado) pertencem ao tenant antes do insert.
 */
export async function createTreatmentStep(
  supabase: SupabaseClient<Database>,
  input: CreateTreatmentStepInput,
): Promise<CreateTreatmentStepResult> {
  const pat = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .maybeSingle()
  if (pat.error) throw new Error(`patient lookup: ${pat.error.message}`)
  if (!pat.data) throw new NotFoundError('patient', input.patientId)

  const proc = await supabase
    .from('procedures')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.procedureId)
    .maybeSingle()
  if (proc.error) throw new Error(`procedure lookup: ${proc.error.message}`)
  if (!proc.data) throw new NotFoundError('procedure', input.procedureId)

  if (input.healthPlanId) {
    const hp = await supabase
      .from('health_plans')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('id', input.healthPlanId)
      .maybeSingle()
    if (hp.error) throw new Error(`health plan lookup: ${hp.error.message}`)
    if (!hp.data) throw new NotFoundError('health_plan', input.healthPlanId)
  }

  const doc = await supabase
    .from('doctors')
    .select('id, active')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.doctorId)
    .maybeSingle()
  if (doc.error) throw new Error(`doctor lookup: ${doc.error.message}`)
  if (!doc.data) throw new NotFoundError('doctor', input.doctorId)

  const { data, error } = await supabase
    .from('treatment_plan_steps')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      procedure_id: input.procedureId,
      doctor_id: input.doctorId,
      plan_id: input.healthPlanId ?? null,
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      scheduled_date: input.scheduledDate ?? null,
      tooth_fdi: input.toothFdi ?? null,
      surface: input.surface ?? null,
      created_by: input.actorUserId,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`createTreatmentStep failed: ${error?.message}`)
  return { id: data.id }
}
