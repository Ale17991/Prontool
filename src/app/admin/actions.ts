'use server'

import { revalidatePath } from 'next/cache'
import { platformAdminUserId } from '@/lib/auth/platform-admin'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

const PLANS = ['essencial', 'pro', 'clinica', 'legacy']
const MODULES = ['tiss', 'portal_paciente', 'telemedicina', 'crm']

export interface AdminActionResult {
  ok: boolean
  error?: string
}

/**
 * Feature 031 — define plano/módulos de um tenant (painel Admin-Agência).
 * Re-verifica Admin-Agência (defense-in-depth) antes de escrever.
 */
export async function setTenantPlanAction(input: {
  tenantId: string
  plan: string
  modules: string[]
}): Promise<AdminActionResult> {
  if (!(await platformAdminUserId())) {
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

  revalidatePath('/admin')
  return { ok: true }
}
