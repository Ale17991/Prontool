import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'

/**
 * Vincula (ou desvincula, com `userId=null`) um profissional a uma conta de
 * login (doctors.user_id). É o que permite a esse usuário operar/prescrever como
 * aquele médico. Unicidade (tenant_id, user_id): um usuário só pode estar
 * vinculado a UM profissional — colisão vira 409.
 */
export async function linkDoctorUser(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; doctorId: string; userId: string | null },
): Promise<void> {
  const sb = supabase as unknown as SupabaseClient

  if (args.userId) {
    // O usuário precisa pertencer à clínica.
    const { data: member, error: mErr } = await sb
      .from('user_tenants')
      .select('user_id')
      .eq('tenant_id', args.tenantId)
      .eq('user_id', args.userId)
      .maybeSingle()
    if (mErr) throw new Error(`linkDoctorUser member lookup: ${mErr.message}`)
    if (!member) {
      throw new ValidationError('user_not_in_tenant', { field: 'user_id' })
    }
  }

  const { data, error } = await sb
    .from('doctors')
    .update({ user_id: args.userId })
    .eq('id', args.doctorId)
    .eq('tenant_id', args.tenantId)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      throw new ConflictError(
        'USER_ALREADY_LINKED',
        'Este usuário já está vinculado a outro profissional. Desvincule lá antes.',
      )
    }
    throw new Error(`linkDoctorUser failed: ${error.message}`)
  }
  if (!data) throw new NotFoundError('doctor', args.doctorId)
}
