import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { issueResetLink } from '@/lib/core/auth/password-reset'

/**
 * Admin dispara o e-mail de redefinição de senha para um membro da equipe.
 *
 * Passou a usar `issueResetLink` — o MESMO envio do pedido público. Antes era
 * `resetPasswordForEmail`, em que quem envia é o Supabase: o membro da equipe
 * recebia de um remetente diferente do que recebe quando pede sozinho, e o link
 * atravessava o redirect que depende da allowlist de Redirect URLs. Quando ela
 * não bate, o Supabase cai no Site URL e o destino quebra (19/08/2026).
 */
export async function sendTeamMemberPasswordReset(
  supabaseService: SupabaseClient<Database>,
  args: { tenantId: string; actorId: string; targetUserId: string; baseUrl: string },
): Promise<{ email: string }> {
  // Garante que o alvo é membro deste tenant (não envia para outra clínica).
  const { data: link, error: linkErr } = await supabaseService
    .from('user_tenants')
    .select('user_id')
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.targetUserId)
    .maybeSingle()
  if (linkErr) throw new Error(`sendTeamMemberPasswordReset link failed: ${linkErr.message}`)
  if (!link) throw new NotFoundError('user_tenant', args.targetUserId)

  const { data: userRes, error: userErr } = await supabaseService.auth.admin.getUserById(
    args.targetUserId,
  )
  if (userErr) throw new Error(`sendTeamMemberPasswordReset getUser failed: ${userErr.message}`)
  const email = userRes.user?.email
  if (!email) throw new ValidationError('Usuário sem e-mail cadastrado.')

  const res = await issueResetLink(supabaseService, { email, baseUrl: args.baseUrl })
  if (!res.sent) {
    throw new Error(`envio da redefinicao falhou (${res.reason}): ${res.detail ?? 'sem detalhe'}`)
  }

  await supabaseService.from('audit_log').insert({
    tenant_id: args.tenantId,
    actor_id: args.actorId,
    actor_label: null,
    entity: 'user_tenants',
    entity_id: args.targetUserId,
    field: 'password_reset_sent',
    old_value: null,
    new_value: null,
    reason: 'admin enviou e-mail de redefinição de senha',
    result: 'success',
  } as never)

  return { email }
}
