import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export async function softDeleteExpense(
  supabase: SupabaseClient<Database>,
  params: {
    id: string
    tenantId: string
    actorUserId: string
  },
) {
  const { error } = await supabase
    .from('expenses')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: params.actorUserId,
    })
    .eq('id', params.id)
    .eq('tenant_id', params.tenantId)
    .is('deleted_at', null)

  if (error) throw new Error(`softDeleteExpense failed: ${error.message}`)
}
