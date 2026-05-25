import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database, TenantRole } from '@/lib/db/types'
import { ConflictError, ValidationError } from '@/lib/observability/errors'
import { TENANT_ROLES_ORDERED } from './types'

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(TENANT_ROLES_ORDERED as unknown as [TenantRole, ...TenantRole[]]),
})

interface InviteContext {
  ip?: string | null
  userAgent?: string | null
}

interface InvitedMember {
  userId: string
  email: string
  role: TenantRole
}

/**
 * Convida um usuário para o tenant (research.md R7).
 *
 * Fluxo:
 *   1. Bloqueia se já existe vínculo ATIVO no mesmo tenant.
 *   2. auth.admin.createUser({ email, email_confirm: false }) — se 422
 *      (já existe), reaproveita id existente via auth.admin.listUsers.
 *   3. INSERT em user_tenants (status='active'). Se já existia disabled,
 *      atualiza para active.
 *   4. inviteUserByEmail para enviar o link de definição de senha.
 *   5. Audit_log.
 */
export async function inviteTeamMember(
  supabaseService: SupabaseClient<Database>,
  tenantId: string,
  actorId: string,
  actorEmail: string | null,
  input: unknown,
  context: InviteContext = {},
): Promise<InvitedMember> {
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ValidationError(first?.message ?? 'invalid invite payload', {
      issues: parsed.error.issues,
    })
  }
  const { email, role } = parsed.data

  // 1. Localiza ou cria a conta auth.users
  let userId: string | null = null

  const { data: created, error: createError } = await supabaseService.auth.admin.createUser({
    email,
    email_confirm: false,
  })
  if (created?.user) {
    userId = created.user.id
  } else if (createError) {
    // Mensagem do Supabase quando email já existe varia de versão para
    // versão; em vez de parsear, fazemos lookup explícito. Iteramos no
    // listUsers até achar o email (paginar limit=1000).
    const { data: list } = await supabaseService.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const found = list?.users?.find((u) => u.email?.toLowerCase() === email)
    if (!found) {
      throw new Error(`inviteTeamMember create + lookup falhou: ${createError.message}`)
    }
    userId = found.id
  }
  if (!userId) {
    throw new Error('inviteTeamMember: userId não resolvido')
  }

  // 2. Verifica vínculo existente
  const { data: existingLink } = await supabaseService
    .from('user_tenants')
    .select('user_id, status, role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (existingLink && (existingLink as { status: string }).status === 'active') {
    throw new ConflictError('USER_ALREADY_ACTIVE', 'Usuário já está ativo nesta clínica')
  }

  if (existingLink) {
    // Estava 'disabled' → reativa com a role escolhida.
    const { error: upd } = await supabaseService
      .from('user_tenants')
      .update({ status: 'active', role, disabled_at: null, disabled_by: null })
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
    if (upd) throw new Error(`inviteTeamMember reactivate failed: ${upd.message}`)
  } else {
    const { error: ins } = await supabaseService.from('user_tenants').insert({
      user_id: userId,
      tenant_id: tenantId,
      role,
      status: 'active',
    })
    if (ins) throw new Error(`inviteTeamMember insert link failed: ${ins.message}`)
  }

  // 3. Envia o e-mail de convite (link de definição de senha).
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/welcome`
  const { error: inviteError } = await supabaseService.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  })
  if (inviteError) {
    // Não rollback do vínculo — admin pode reenviar via endpoint específico.
    console.error('inviteTeamMember inviteUserByEmail failed', { email, error: inviteError })
  }

  // 4. Audit
  await supabaseService.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: actorId,
    actor_label: actorEmail,
    entity: 'user_tenants',
    entity_id: userId,
    field: 'invite',
    old_value: null,
    new_value: JSON.stringify({ email, role }),
    reason: 'invited via /api/configuracoes/usuarios/convite POST',
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    result: 'success',
  })

  return { userId, email, role }
}

/**
 * Re-envia o e-mail de convite para um usuário pendente.
 */
export async function resendInvite(
  supabaseService: SupabaseClient<Database>,
  tenantId: string,
  actorId: string,
  actorEmail: string | null,
  targetUserId: string,
  context: InviteContext = {},
): Promise<void> {
  const { data: link } = await supabaseService
    .from('user_tenants')
    .select('user_id, status')
    .eq('user_id', targetUserId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!link) throw new ConflictError('USER_NOT_FOUND', 'Usuário não vinculado à clínica')
  if ((link as { status: string }).status !== 'active') {
    throw new ConflictError('NOT_PENDING', 'Usuário não está em estado de convite pendente')
  }

  const { data: target, error: getError } = await supabaseService.auth.admin.getUserById(targetUserId)
  if (getError || !target?.user) {
    throw new ConflictError('USER_NOT_FOUND', 'Conta não encontrada')
  }
  if (target.user.email_confirmed_at) {
    throw new ConflictError('NOT_PENDING', 'Usuário já confirmou o e-mail')
  }
  if (!target.user.email) {
    throw new ConflictError('NOT_PENDING', 'Usuário sem e-mail registrado')
  }

  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/welcome`
  const { error: inviteError } = await supabaseService.auth.admin.inviteUserByEmail(
    target.user.email,
    { redirectTo },
  )
  if (inviteError) {
    throw new Error(`resendInvite failed: ${inviteError.message}`)
  }

  await supabaseService.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: actorId,
    actor_label: actorEmail,
    entity: 'user_tenants',
    entity_id: targetUserId,
    field: 'invite',
    old_value: null,
    new_value: JSON.stringify({ email: target.user.email, resent: true }),
    reason: 'resent via /api/configuracoes/usuarios/[id]/reenviar-convite POST',
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    result: 'success',
  })
}
