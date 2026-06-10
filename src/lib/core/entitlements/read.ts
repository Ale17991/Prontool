/**
 * Feature 031 — leitura dos entitlements de um tenant (servidor).
 *
 * Linha ausente em `tenant_entitlements` ⇒ tratada como `legacy` (acesso
 * total), defensivo: nenhum tenant fica acidentalmente sem acesso por falta
 * de row. Tenants atuais foram backfillados como `legacy` na migration 0115;
 * contas novas nascem `essencial` via `create_first_tenant`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  ALL_MODULES,
  buildEntitlements,
  type Entitlements,
  type ModuleId,
  type Plan,
} from './plans'

const VALID_PLANS: ReadonlySet<string> = new Set(['essencial', 'pro', 'clinica', 'legacy'])

export async function getTenantEntitlements(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<Entitlements> {
  const { data, error } = await supabase
    .from('tenant_entitlements')
    .select('plan, status, modules')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`getTenantEntitlements: ${error.message}`)
  if (!data) return buildEntitlements('legacy', [...ALL_MODULES])

  const row = data as { plan: string; status: string; modules: string[] | null }
  const plan: Plan = VALID_PLANS.has(row.plan) ? (row.plan as Plan) : 'legacy'
  const modules = (row.modules ?? []).filter((m): m is ModuleId =>
    (ALL_MODULES as readonly string[]).includes(m),
  )
  return buildEntitlements(plan, modules)
}
