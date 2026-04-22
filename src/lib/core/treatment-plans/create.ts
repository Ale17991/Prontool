import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'

export interface CreateTreatmentPlanInput {
  tenantId: string
  patientId: string
  title: string
  description?: string | null
  actorUserId: string
}

export interface CreateTreatmentPlanResult {
  id: string
  createdAt: string
}

export async function createTreatmentPlan(
  supabase: SupabaseClient<Database>,
  input: CreateTreatmentPlanInput,
): Promise<CreateTreatmentPlanResult> {
  // Valida que o paciente existe no tenant antes do insert — o FK pega o
  // caso de id inválido, mas damos uma mensagem mais clara e separamos
  // patient-não-existe de tenant-mismatch.
  const pat = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .maybeSingle()
  if (pat.error) throw new Error(`patient lookup failed: ${pat.error.message}`)
  if (!pat.data) throw new NotFoundError('patient', input.patientId)

  const { data, error } = await supabase
    .from('treatment_plans')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      created_by: input.actorUserId,
    })
    .select('id, created_at')
    .single()

  if (error || !data) throw new Error(`createTreatmentPlan failed: ${error?.message}`)
  return { id: data.id, createdAt: data.created_at }
}
