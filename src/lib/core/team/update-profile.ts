import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/observability/errors'

/**
 * Edita os dados de perfil de um membro da equipe (hoje: nome). Usado pelo admin
 * (editando outros) ou pelo próprio usuário. Via service client — a checagem de
 * permissão (admin OU self) e de pertencimento ao tenant é feita aqui/na rota.
 */
export async function updateTeamMemberProfile(
  supabaseService: SupabaseClient<Database>,
  args: {
    tenantId: string
    actorId: string
    targetUserId: string
    fullName: string
    phone?: string | null
  },
): Promise<void> {
  const fullName = args.fullName.trim()
  if (fullName.length < 1 || fullName.length > 200) {
    throw new ValidationError('Nome deve ter entre 1 e 200 caracteres.')
  }
  const phone = args.phone?.trim() ? args.phone.trim() : null
  if (phone && phone.length > 20) throw new ValidationError('Telefone muito longo.')

  // Garante que o alvo pertence a este tenant (não vaza entre clínicas).
  const { data: link, error: linkErr } = await supabaseService
    .from('user_tenants')
    .select('user_id')
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.targetUserId)
    .maybeSingle()
  if (linkErr) throw new Error(`updateTeamMemberProfile link failed: ${linkErr.message}`)
  if (!link) throw new NotFoundError('user_tenant', args.targetUserId)

  // Permissão: admin do tenant OU o próprio usuário.
  if (args.actorId !== args.targetUserId) {
    const { data: actorLink } = await supabaseService
      .from('user_tenants')
      .select('role')
      .eq('tenant_id', args.tenantId)
      .eq('user_id', args.actorId)
      .maybeSingle()
    if ((actorLink as { role?: string } | null)?.role !== 'admin') {
      throw new ForbiddenError('Apenas administradores podem editar outros usuários.')
    }
  }

  const { data: before } = await supabaseService
    .from('user_profile')
    .select('full_name, phone')
    .eq('user_id', args.targetUserId)
    .maybeSingle()
  const prev = before as { full_name?: string | null; phone?: string | null } | null
  const oldName = prev?.full_name ?? null
  const oldPhone = prev?.phone ?? null

  const { error: upErr } = await supabaseService.from('user_profile').upsert(
    {
      user_id: args.targetUserId,
      full_name: fullName,
      phone,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: 'user_id' } as never,
  )
  if (upErr) throw new Error(`updateTeamMemberProfile upsert failed: ${upErr.message}`)

  if (oldName !== fullName) {
    await supabaseService.from('audit_log').insert({
      tenant_id: args.tenantId,
      actor_id: args.actorId,
      actor_label: null,
      entity: 'user_profile',
      entity_id: args.targetUserId,
      field: 'full_name',
      old_value: oldName,
      new_value: fullName,
      reason: 'edição de dados do usuário via /api/configuracoes/usuarios/[userId]/perfil',
      result: 'success',
    } as never)
  }
  if (oldPhone !== phone) {
    await supabaseService.from('audit_log').insert({
      tenant_id: args.tenantId,
      actor_id: args.actorId,
      actor_label: null,
      entity: 'user_profile',
      entity_id: args.targetUserId,
      field: 'phone',
      old_value: oldPhone,
      new_value: phone,
      reason: 'edição de dados do usuário via /api/configuracoes/usuarios/[userId]/perfil',
      result: 'success',
    } as never)
  }
}
