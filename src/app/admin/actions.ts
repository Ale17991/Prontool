'use server'

import { revalidatePath } from 'next/cache'
import { superAdminUserId } from '@/lib/auth/platform-admin'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createManualUser } from '@/lib/core/team/create-manual'
import { ALL_MODULES, COMING_SOON_MODULES } from '@/lib/core/entitlements/plans'

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

/**
 * Cria uma clínica nova (tenant + entitlement no plano escolhido + usuário
 * admin inicial). Só admin GERAL. Via service client.
 */
export async function adminCreateClinicAction(input: {
  name: string
  slug: string
  plan: string
  adminName: string
  adminEmail: string
  adminPassword: string
}): Promise<AdminActionResult> {
  const actorId = await superAdminUserId()
  if (!actorId) return { ok: false, error: 'Não autorizado.' }

  const name = input.name.trim()
  const slug = slugify(input.slug || input.name)
  if (name.length < 2) return { ok: false, error: 'Nome da clínica inválido.' }
  if (!/^[a-z0-9-]{2,}$/.test(slug)) return { ok: false, error: 'Slug inválido (use letras/números).' }
  if (!PLANS.includes(input.plan)) return { ok: false, error: 'Plano inválido.' }
  if (!input.adminEmail.includes('@')) return { ok: false, error: 'E-mail do admin inválido.' }
  if ((input.adminPassword ?? '').length < 8) {
    return { ok: false, error: 'Senha do admin: mínimo 8 caracteres.' }
  }

  const sb: any = createSupabaseServiceClient()
  const { data: t, error: tErr } = await sb
    .from('tenants')
    .insert({ name, slug, status: 'active' })
    .select('id')
    .single()
  if (tErr) {
    return {
      ok: false,
      error: /duplicate|unique/i.test(tErr.message) ? 'Já existe uma clínica com esse slug.' : tErr.message,
    }
  }
  const tenantId = (t as { id: string }).id

  await sb.rpc('set_tenant_entitlement', {
    p_tenant_id: tenantId,
    p_plan: input.plan,
    p_modules: [],
    p_status: 'active',
  })

  try {
    await createManualUser(sb, tenantId, actorId, null, {
      full_name: input.adminName.trim() || input.adminEmail.trim(),
      email: input.adminEmail.trim(),
      password: input.adminPassword,
      role: 'admin',
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Clínica criada, mas falhou ao criar o admin.' }
  }

  revalidatePath('/admin', 'layout')
  return { ok: true }
}

const PLANS = ['essencial', 'pro', 'clinica', 'legacy']
// Controláveis no painel = catálogo completo MENOS os "em breve". Inclui
// treino/dieta (antes eram mostrados mas descartados ao salvar).
const MODULES: string[] = ALL_MODULES.filter(
  (m) => !COMING_SOON_MODULES.includes(m),
)

export interface AdminActionResult {
  ok: boolean
  error?: string
}

/**
 * Feature 031 — define plano/módulos de um tenant. Só admin GERAL (is_super).
 */
export async function setTenantPlanAction(input: {
  tenantId: string
  plan: string
  modules: string[]
}): Promise<AdminActionResult> {
  if (!(await superAdminUserId())) {
    return { ok: false, error: 'Não autorizado.' }
  }
  if (!input.tenantId || !PLANS.includes(input.plan)) {
    return { ok: false, error: 'Tenant ou plano inválido.' }
  }
  const modules = (input.modules ?? []).filter((m) => MODULES.includes(m))

  const sb = createSupabaseServiceClient()
  // Preserva o status de cobrança atual (trial/past_due/canceled) — salvar
  // plano/módulos não pode reverter tudo para 'active'.
  const cur = await sb
    .from('tenant_entitlements')
    .select('status')
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  const currentStatus = (cur.data as { status?: string } | null)?.status ?? 'active'
  const { error } = await sb.rpc('set_tenant_entitlement' as never, {
    p_tenant_id: input.tenantId,
    p_plan: input.plan,
    p_modules: modules,
    p_status: currentStatus,
  } as never)
  if (error) return { ok: false, error: error.message }

  // 'layout' revalida tudo sob /admin (lista + detalhe da clínica), senão o
  // detalhe servia checkboxes em cache e parecia que o módulo não reativou.
  revalidatePath('/admin', 'layout')
  return { ok: true }
}

/**
 * Define o status de COBRANÇA + fim do trial de uma clínica (não confundir com
 * tenants.status, que é o pausar/reativar). Só admin GERAL. Via service client
 * (service_role tem grant de escrita em tenant_entitlements).
 */
export async function setTenantBillingAction(input: {
  tenantId: string
  status: 'trial' | 'active' | 'past_due' | 'canceled'
  trialEndsAt: string | null
}): Promise<AdminActionResult> {
  if (!(await superAdminUserId())) {
    return { ok: false, error: 'Não autorizado.' }
  }
  if (!['trial', 'active', 'past_due', 'canceled'].includes(input.status)) {
    return { ok: false, error: 'Status inválido.' }
  }
  const trialEndsAt =
    input.status === 'trial' && input.trialEndsAt && /^\d{4}-\d{2}-\d{2}$/.test(input.trialEndsAt)
      ? input.trialEndsAt
      : null
  const sb = createSupabaseServiceClient()
  const { error } = await sb
    .from('tenant_entitlements')
    .update({ status: input.status, trial_ends_at: trialEndsAt, updated_at: new Date().toISOString() } as never)
    .eq('tenant_id', input.tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin', 'layout')
  return { ok: true }
}

/**
 * Pausa (suspended) ou reativa (active) uma clínica inteira. Suspensa, a clínica
 * some das clínicas disponíveis do usuário (available-tenants filtra status
 * active) → ninguém consegue operá-la. Só admin GERAL.
 */
export async function setTenantStatusAction(input: {
  tenantId: string
  status: 'active' | 'suspended'
}): Promise<AdminActionResult> {
  if (!(await superAdminUserId())) {
    return { ok: false, error: 'Não autorizado.' }
  }
  if (!input.tenantId || !['active', 'suspended'].includes(input.status)) {
    return { ok: false, error: 'Parâmetros inválidos.' }
  }
  const sb = createSupabaseServiceClient()
  const { error } = await sb
    .from('tenants')
    .update({ status: input.status, updated_at: new Date().toISOString() } as never)
    .eq('id', input.tenantId)
  if (error) return { ok: false, error: error.message }

  // 'layout' revalida tudo sob /admin (lista + detalhe da clínica), senão o
  // detalhe servia checkboxes em cache e parecia que o módulo não reativou.
  revalidatePath('/admin', 'layout')
  return { ok: true }
}

/**
 * Feature 031 — atribui (on=true) ou remove (on=false) uma clínica de um
 * usuário de SUPORTE (platform_admins.is_super=false). Só admin GERAL.
 */
export async function setSupportTenantAccessAction(input: {
  supportUserId: string
  tenantId: string
  on: boolean
}): Promise<AdminActionResult> {
  if (!(await superAdminUserId())) {
    return { ok: false, error: 'Não autorizado.' }
  }
  if (!input.supportUserId || !input.tenantId) {
    return { ok: false, error: 'Parâmetros inválidos.' }
  }
  const sb: any = createSupabaseServiceClient()

  // Garante que o alvo é um usuário de suporte (não-super).
  const target = await sb
    .from('platform_admins')
    .select('user_id, is_super')
    .eq('user_id', input.supportUserId)
    .maybeSingle()
  if (!target.data || target.data.is_super) {
    return { ok: false, error: 'Alvo não é um usuário de suporte.' }
  }

  if (input.on) {
    const { error } = await sb
      .from('platform_admin_tenants')
      .upsert(
        { user_id: input.supportUserId, tenant_id: input.tenantId },
        { onConflict: 'user_id,tenant_id' },
      )
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await sb
      .from('platform_admin_tenants')
      .delete()
      .eq('user_id', input.supportUserId)
      .eq('tenant_id', input.tenantId)
    if (error) return { ok: false, error: error.message }
  }

  // 'layout' revalida tudo sob /admin (lista + detalhe da clínica), senão o
  // detalhe servia checkboxes em cache e parecia que o módulo não reativou.
  revalidatePath('/admin', 'layout')
  return { ok: true }
}
