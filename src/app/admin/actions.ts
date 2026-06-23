'use server'

import { revalidatePath } from 'next/cache'
import { superAdminUserId } from '@/lib/auth/platform-admin'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { ALL_MODULES, COMING_SOON_MODULES } from '@/lib/core/entitlements/plans'

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
  const { error } = await sb.rpc('set_tenant_entitlement' as never, {
    p_tenant_id: input.tenantId,
    p_plan: input.plan,
    p_modules: modules,
    p_status: 'active',
  } as never)
  if (error) return { ok: false, error: error.message }

  // 'layout' revalida tudo sob /admin (lista + detalhe da clínica), senão o
  // detalhe servia checkboxes em cache e parecia que o módulo não reativou.
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
