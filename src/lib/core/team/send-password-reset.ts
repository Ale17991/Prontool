import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { resolvePublicBaseUrl } from '@/lib/core/app-url'

/**
 * Admin dispara o e-mail de redefinição de senha para um membro da equipe.
 * Usa `resetPasswordForEmail` (o Supabase ENVIA o e-mail, igual ao convite),
 * com redirectTo de produção → `/redefinir-senha`. Requer Site URL + Redirect
 * URLs configurados no Supabase (ver project-auth-url-config).
 */
export async function sendTeamMemberPasswordReset(
  supabaseService: SupabaseClient<Database>,
  args: { tenantId: string; actorId: string; targetUserId: string },
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

  const redirectTo = `${resolvePublicBaseUrl()}/redefinir-senha`
  const { error: resetErr } = await supabaseService.auth.resetPasswordForEmail(email, {
    redirectTo,
  })
  if (resetErr) throw new Error(`resetPasswordForEmail failed: ${resetErr.message}`)

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
