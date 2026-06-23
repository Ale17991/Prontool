import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { createTreatmentStep } from '@/lib/core/treatment-steps/create'
import { isValidSurface, isValidTooth, type Surface } from '@/lib/core/dental/teeth'

export interface AddPlanItemInput {
  tenantId: string
  patientId: string
  procedureId: string
  doctorId: string
  healthPlanId?: string | null
  title: string
  notes?: string | null
  scheduledDate?: string | null
  toothFdi: number
  surface?: Surface | null
  actorUserId: string
}

/**
 * Cria um item de plano de tratamento odontológico: uma etapa
 * (`treatment_plan_steps`) com posição dentária (dente FDI + face opcional).
 * Reusa `createTreatmentStep` (valida paciente/procedimento/plano/médico no
 * tenant) e acrescenta a validação de posição.
 */
export async function addPlanItem(
  supabase: SupabaseClient<Database>,
  input: AddPlanItemInput,
): Promise<{ id: string }> {
  if (!isValidTooth(input.toothFdi)) {
    throw new ValidationError('Dente FDI inválido', { toothFdi: input.toothFdi })
  }
  const surface = input.surface ?? null
  if (surface !== null && !isValidSurface(surface)) {
    throw new ValidationError('Face inválida', { surface })
  }

  return createTreatmentStep(supabase, {
    tenantId: input.tenantId,
    patientId: input.patientId,
    procedureId: input.procedureId,
    doctorId: input.doctorId,
    healthPlanId: input.healthPlanId ?? null,
    title: input.title,
    notes: input.notes ?? null,
    scheduledDate: input.scheduledDate ?? null,
    toothFdi: input.toothFdi,
    surface,
    actorUserId: input.actorUserId,
  })
}
