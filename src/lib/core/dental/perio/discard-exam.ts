import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError } from '@/lib/observability/errors'

/**
 * Descarta um exame em rascunho (DELETE). Exame finalizado não pode ser
 * removido — o trigger de banco rejeita e o erro vira `EXAM_FINALIZED`.
 */
export async function discardPerioExam(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; examId: string },
): Promise<void> {
  const current = await supabase
    .from('perio_exams')
    .select('id, status')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.examId)
    .maybeSingle()
  if (current.error) throw new Error(`exam lookup: ${current.error.message}`)
  if (!current.data) throw new NotFoundError('perio_exam', input.examId)
  if (current.data.status !== 'rascunho') {
    throw new ConflictError('EXAM_FINALIZED', 'Não é possível excluir um exame finalizado.')
  }

  const res = await supabase
    .from('perio_exams')
    .delete()
    .eq('tenant_id', input.tenantId)
    .eq('id', input.examId)
    .eq('status', 'rascunho')
  if (res.error) {
    if (res.error.code === '42501') {
      throw new ConflictError('EXAM_FINALIZED', 'Não é possível excluir um exame finalizado.')
    }
    throw new Error(`discardPerioExam failed: ${res.error.message}`)
  }
}
