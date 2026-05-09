import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database, TenantRole } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { TENANT_ROLES_ORDERED } from './types'

const schema = z.object({
  role: z.enum(TENANT_ROLES_ORDERED as unknown as [TenantRole, ...TenantRole[]]),
})

interface Context {
  ip?: string | null
  userAgent?: string | null
}

/**
 * Atualiza a função de um usuário do tenant.
 *
 * Regras:
 *  - Não pode rebaixar a si mesmo se for a única admin ativa (também
 *    enforced pelo trigger `enforce_last_admin` no banco como segunda
 *    barreira).
 *  - Auditoria: entity=user_tenants, field=role, old/new.
 */
export async function setTeamMemberRole(
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
    throw new ValidationError(first?.message ?? 'invalid role payload')
  }
  const { role: newRole } = parsed.data

  const { data: existing } = await supabaseService
    .from('user_tenants')
    .select('user_id, role, status')
    .eq('user_id', targetUserId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!existing) throw new NotFoundError('user_tenants', targetUserId)
  const oldRole = (existing as { role: TenantRole }).role
  if (oldRole === newRole) return

  // Pré-check da última admin (defesa primária; trigger é a final).
  if (oldRole === 'admin' && newRole !== 'admin' && targetUserId === actorId) {
    const { data: lastCheck } = await supabaseService.rpc('is_last_active_admin', {
      p_tenant_id: tenantId,
      p_user_id: targetUserId,
    } as never)
    if (lastCheck === true) {
      throw new ConflictError('LAST_ADMIN', 'Não é possível rebaixar a única administradora ativa')
    }
  }

  const { error: updError } = await supabaseService
    .from('user_tenants')
    .update({ role: newRole })
    .eq('user_id', targetUserId)
    .eq('tenant_id', tenantId)
  if (updError) {
    if (updError.code === '23514' || /enforce_last_admin/.test(updError.message)) {
      throw new ConflictError('LAST_ADMIN', 'Não é possível rebaixar a única administradora ativa')
    }
    throw new Error(`setTeamMemberRole update failed: ${updError.message}`)
  }

  await supabaseService.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: actorId,
    actor_label: actorEmail,
    entity: 'user_tenants',
    entity_id: targetUserId,
    field: 'role',
    old_value: oldRole,
    new_value: newRole,
    reason: 'role changed via /api/configuracoes/usuarios/[id] PATCH',
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    result: 'success',
  })
}
