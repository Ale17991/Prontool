import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError } from '@/lib/observability/errors'

/**
 * Finaliza um exame (rascunho → finalizado), congelando-o como snapshot. O
 * trigger de banco valida a transição; estados terminais viram
 * `INVALID_TRANSITION`.
 */
export async function finalizePerioExam(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; examId: string; actorUserId: string },
): Promise<{ status: string; finalizedAt: string | null }> {
  const current = await supabase
    .from('perio_exams')
    .select('id, status')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.examId)
    .maybeSingle()
  if (current.error) throw new Error(`exam lookup: ${current.error.message}`)
  if (!current.data) throw new NotFoundError('perio_exam', input.examId)
  if (current.data.status !== 'rascunho') {
    throw new ConflictError('INVALID_TRANSITION', 'Exame já finalizado.')
  }

  const res = await supabase
    .from('perio_exams')
    .update({
      status: 'finalizado',
      finalized_at: new Date().toISOString(),
      finalized_by: input.actorUserId,
    })
    .eq('tenant_id', input.tenantId)
    .eq('id', input.examId)
    .eq('status', 'rascunho')
    .select('status, finalized_at')
    .maybeSingle()
  if (res.error) {
    if (res.error.code === '42501') {
      throw new ConflictError('INVALID_TRANSITION', 'Transição de exame inválida.')
    }
    throw new Error(`finalizePerioExam failed: ${res.error.message}`)
  }
  if (!res.data) throw new ConflictError('INVALID_TRANSITION', 'Exame já finalizado.')
  return { status: res.data.status, finalizedAt: res.data.finalized_at }
}
