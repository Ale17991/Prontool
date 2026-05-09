import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'

const schema = z.object({
  status: z.enum(['active', 'disabled']),
})

interface Context {
  ip?: string | null
  userAgent?: string | null
}

/**
 * Ativa ou desativa um vínculo user_tenants.
 *
 * Regras:
 *  - Admin não pode desativar a si mesmo.
 *  - Admin não pode ser desativado se for a única admin ativa (trigger
 *    `enforce_last_admin` é a barreira final no DB).
 *  - Reativar (disabled → active) NÃO dispara novo convite (R6/R7) —
 *    a conta de auth.users é preservada.
 *  - Audit_log: entity=user_tenants, field=status, old/new.
 */
export async function setTeamMemberStatus(
  supabaseService: SupabaseClient<Database>,
  tenantId: string,
  actorId: string,
  actorEmail: string | null,
  targetUserId: string,
  input: unknown,
  context: Context = {},
): Promise<void> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ValidationError(first?.message ?? 'invalid status payload')
  }
  const { status: newStatus } = parsed.data

  if (targetUserId === actorId && newStatus === 'disabled') {
    throw new ConflictError('CANNOT_DISABLE_SELF', 'Você não pode desativar a si mesmo')
  }

  const { data: existing } = await supabaseService
    .from('user_tenants')
    .select('user_id, role, status')
    .eq('user_id', targetUserId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!existing) throw new NotFoundError('user_tenants', targetUserId)

  const oldStatus = (existing as { status: 'active' | 'disabled' }).status
  if (oldStatus === newStatus) return

  // Pré-check última admin: se admin ativa virando disabled.
  if (
    (existing as { role: string }).role === 'admin' &&
    oldStatus === 'active' &&
    newStatus === 'disabled'
  ) {
    const { data: lastCheck } = await supabaseService.rpc('is_last_active_admin', {
      p_tenant_id: tenantId,
      p_user_id: targetUserId,
    } as never)
    if (lastCheck === true) {
      throw new ConflictError('LAST_ADMIN', 'Não é possível desativar a única administradora ativa')
    }
  }

  const updates =
    newStatus === 'disabled'
      ? { status: 'disabled' as const, disabled_at: new Date().toISOString(), disabled_by: actorId }
      : { status: 'active' as const, disabled_at: null, disabled_by: null }

  const { error: updError } = await supabaseService
    .from('user_tenants')
    .update(updates)
    .eq('user_id', targetUserId)
    .eq('tenant_id', tenantId)
  if (updError) {
    if (updError.code === '23514' || /enforce_last_admin/.test(updError.message)) {
      throw new ConflictError('LAST_ADMIN', 'Não é possível desativar a única administradora ativa')
    }
    throw new Error(`setTeamMemberStatus update failed: ${updError.message}`)
  }

  await supabaseService.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: actorId,
    actor_label: actorEmail,
    entity: 'user_tenants',
    entity_id: targetUserId,
    field: 'status',
    old_value: oldStatus,
    new_value: newStatus,
    reason: 'status changed via /api/configuracoes/usuarios/[id]/status PATCH',
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    result: 'success',
  })
}
