import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database, TenantRole } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { TENANT_ROLES_ORDERED } from './types'

/**
 * Feature 012 — US3 — cadastra um usuário manualmente (admin define senha).
 *
 * Difere do convite por email (./invite.ts) em 3 pontos:
 *   1. `email_confirm: true` — conta já confirmada; usuário loga imediato.
 *   2. Senha definida pelo admin no momento da criação (≥ 8 chars).
 *   3. Opcionalmente vincula a um profissional existente (doctors.user_id).
 */
const schema = z.object({
  full_name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(72),
  phone: z.string().trim().max(40).optional().nullable(),
  role: z.enum(TENANT_ROLES_ORDERED as unknown as [TenantRole, ...TenantRole[]]),
  doctor_id: z.string().uuid().nullable().optional(),
})

interface Context {
  ip?: string | null
  userAgent?: string | null
}

export interface ManualUserResult {
  userId: string
  email: string
  role: TenantRole
  linkedDoctor: { id: string; fullName: string } | null
}

export async function createManualUser(
  supabaseService: SupabaseClient<Database>,
  tenantId: string,
  actorId: string,
  actorEmail: string | null,
  input: unknown,
  context: Context = {},
): Promise<ManualUserResult> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'invalid payload', {
      issues: parsed.error.issues,
    })
  }
  const { email, password, role, full_name, phone, doctor_id } = parsed.data

  // 1. Se doctor_id informado: valida pertence ao tenant + sem user_id.
  let linkedDoctor: { id: string; full_name: string } | null = null
  if (doctor_id) {
    const { data: d } = await supabaseService
      .from('doctors')
      .select('id, full_name, user_id, tenant_id')
      .eq('id', doctor_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!d) throw new NotFoundError('doctor', doctor_id)
    const row = d as { id: string; full_name: string; user_id: string | null }
    if (row.user_id) {
      throw new ConflictError(
        'DOCTOR_ALREADY_LINKED',
        'Este profissional já está vinculado a outro usuário.',
      )
    }
    linkedDoctor = { id: row.id, full_name: row.full_name }
  }

  // 2. Cria conta auth com email confirmado + senha.
  let userId: string | null = null
  const { data: created, error: createError } = await supabaseService.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (created?.user) {
    userId = created.user.id
  } else if (createError) {
    // Email já existe — localiza o user_id e valida que NÃO está vinculado ao tenant.
    const { data: list } = await supabaseService.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const found = list?.users?.find((u) => u.email?.toLowerCase() === email)
    if (!found) {
      throw new Error(`createManualUser create+lookup falhou: ${createError.message}`)
    }
    userId = found.id

    const { data: existingLink } = await supabaseService
      .from('user_tenants')
      .select('status')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (existingLink && (existingLink as { status: string }).status === 'active') {
      throw new ConflictError(
        'USER_ALREADY_ACTIVE',
        'Esse e-mail já está vinculado à clínica.',
      )
    }
  }
  if (!userId) throw new Error('createManualUser: userId não resolvido')

  // 3. INSERT/UPSERT user_tenants
  const { data: existingLink } = await supabaseService
    .from('user_tenants')
    .select('user_id, status')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (existingLink) {
    // disabled → reativa com role
    const { error: updErr } = await supabaseService
      .from('user_tenants')
      .update({ status: 'active', role, disabled_at: null, disabled_by: null } as never)
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
    if (updErr) throw new Error(`createManualUser reactivate failed: ${updErr.message}`)
  } else {
    const { error: insErr } = await supabaseService.from('user_tenants').insert({
      user_id: userId,
      tenant_id: tenantId,
      role,
      status: 'active',
    } as never)
    if (insErr) throw new Error(`createManualUser insert link failed: ${insErr.message}`)
  }

  // 4. Upsert user_profile (full_name, phone) — best-effort.
  try {
    await supabaseService
      .from('user_profile')
      .upsert(
        {
          user_id: userId,
          full_name,
          phone: phone ?? null,
        } as never,
        { onConflict: 'user_id' },
      )
  } catch {
    // ignora falha não-crítica.
  }

  // 5. Se vincular a doctor: UPDATE doctors.user_id.
  if (doctor_id && linkedDoctor) {
    const { error: upDocErr } = await supabaseService
      .from('doctors')
      .update({ user_id: userId } as never)
      .eq('id', doctor_id)
      .eq('tenant_id', tenantId)
    if (upDocErr) {
      if (upDocErr.code === '23505') {
        throw new ConflictError(
          'DOCTOR_ALREADY_LINKED',
          'Profissional já vinculado a outro usuário nesta clínica.',
        )
      }
      throw new Error(`createManualUser update doctor failed: ${upDocErr.message}`)
    }
  }

  // 6. Audit
  await supabaseService.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: actorId,
    actor_label: actorEmail,
    entity: 'user_tenants',
    entity_id: userId,
    field: 'manual_create',
    old_value: null,
    new_value: JSON.stringify({
      email,
      role,
      doctor_id: doctor_id ?? null,
    }),
    reason: 'manual user created via /api/configuracoes/usuarios/manual',
    ip: context.ip ?? null,
    user_agent: context.userAgent ?? null,
    result: 'success',
  } as never)

  return {
    userId,
    email,
    role,
    linkedDoctor: linkedDoctor
      ? { id: linkedDoctor.id, fullName: linkedDoctor.full_name }
      : null,
  }
}
