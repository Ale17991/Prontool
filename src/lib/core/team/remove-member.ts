import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ForbiddenError, NotFoundError } from '@/lib/observability/errors'
import type { TenantRole } from '@/lib/db/types'

/** Posto hierárquico: admin é o topo; demais papéis ficam abaixo. */
function rank(role: TenantRole): number {
  return role === 'admin' ? 1 : 0
}

/**
 * Remove um usuário da clínica (apaga o vínculo user_tenants do tenant). Regra
 * pedida: o ator só remove quem tem função INFERIOR à dele (não remove iguais/
 * superiores nem a si mesmo). A conta de auth permanece (pode ter outras
 * clínicas / re-convite). Via service client; permissão validada aqui + admin na
 * rota.
 */
export async function removeTeamMember(
  supabaseService: SupabaseClient<Database>,
  args: { tenantId: string; actorId: string; targetUserId: string },
): Promise<void> {
  if (args.actorId === args.targetUserId) {
    throw new ForbiddenError('Você não pode remover a si mesmo.')
  }

  const { data: actorLink } = await supabaseService
    .from('user_tenants')
    .select('role')
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.actorId)
    .maybeSingle()
  const actorRole = (actorLink as { role?: TenantRole } | null)?.role
  if (actorRole !== 'admin') {
    throw new ForbiddenError('Apenas administradores podem remover usuários.')
  }

  const { data: targetLink } = await supabaseService
    .from('user_tenants')
    .select('role')
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.targetUserId)
    .maybeSingle()
  const targetRole = (targetLink as { role?: TenantRole } | null)?.role
  if (!targetRole) throw new NotFoundError('user_tenant', args.targetUserId)

  if (rank(targetRole) >= rank(actorRole)) {
    throw new ForbiddenError(
      'Não é possível remover um usuário com função igual ou superior à sua.',
    )
  }

  const { error: delErr } = await supabaseService
    .from('user_tenants')
    .delete()
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.targetUserId)
  if (delErr) throw new Error(`removeTeamMember failed: ${delErr.message}`)

  await supabaseService.from('audit_log').insert({
    tenant_id: args.tenantId,
    actor_id: args.actorId,
    actor_label: null,
    entity: 'user_tenants',
    entity_id: args.targetUserId,
    field: 'removed',
    old_value: targetRole,
    new_value: null,
    reason: 'usuário removido da clínica via /api/configuracoes/usuarios/[userId] DELETE',
    result: 'success',
  } as never)
}
