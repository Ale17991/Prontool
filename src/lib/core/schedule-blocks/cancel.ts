import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'

interface CancelInput {
  tenantId: string
  blockId: string
  actorUserId: string
  /** Quando role e 'profissional_saude', o handler passa o doctor_id do
   * usuario; cancelamos so se o bloqueio pertence a esse doctor. */
  restrictToDoctorId?: string | null
}

/**
 * Soft delete: seta deleted_at + deleted_by. O trigger
 * enforce_schedule_block_mutability bloqueia qualquer outro UPDATE.
 */
export async function cancelScheduleBlock(
  supabase: SupabaseClient<Database>,
  input: CancelInput,
): Promise<void> {
  const cur = await supabase
    .from('schedule_blocks' as never)
    .select('id, doctor_id, deleted_at')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.blockId)
    .maybeSingle()
  if (cur.error) throw new Error(`schedule_blocks lookup: ${cur.error.message}`)
  if (!cur.data) throw new NotFoundError('schedule_block', input.blockId)

  const row = cur.data as { id: string; doctor_id: string; deleted_at: string | null }
  if (row.deleted_at) {
    // Idempotente: ja cancelado, no-op.
    return
  }
  if (input.restrictToDoctorId && row.doctor_id !== input.restrictToDoctorId) {
    throw new DomainError(
      'FORBIDDEN',
      'Você só pode cancelar bloqueios da sua própria agenda.',
      { status: 403 },
    )
  }

  const upd = await supabase
    .from('schedule_blocks' as never)
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: input.actorUserId,
    } as never)
    .eq('tenant_id', input.tenantId)
    .eq('id', input.blockId)
  if (upd.error) {
    throw new Error(`cancelScheduleBlock failed: ${upd.error.message}`)
  }
}
