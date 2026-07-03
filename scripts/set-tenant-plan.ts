#!/usr/bin/env tsx
/**
 * Ops — define o plano e os módulos de um tenant (feature 031).
 *
 * Uso:
 *   pnpm tsx --env-file=.env.local scripts/set-tenant-plan.ts <slug|tenantId> <plano> [--modules a,b] [--status active]
 *   pnpm tsx --env-file=.env.production.local scripts/set-tenant-plan.ts clinica-x pro --modules tiss,portal_paciente
 *
 * Planos: essencial | pro | clinica | legacy
 * Módulos: tiss | portal_paciente | telemedicina | crm   (crm já vem embutido no Clínica)
 */
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

const PLANS = ['essencial', 'pro', 'clinica', 'legacy']
const MODULES = ['tiss', 'portal_paciente', 'telemedicina', 'crm']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const sb: any = createSupabaseServiceClient()
  const [target, plan] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (!target || !plan) {
    console.error('uso: set-tenant-plan <slug|tenantId> <plano> [--modules a,b] [--status active]')
    process.exit(1)
  }
  if (!PLANS.includes(plan)) {
    console.error(`plano inválido: ${plan} (use: ${PLANS.join(' | ')})`)
    process.exit(1)
  }
  const modules = (flag('modules') ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  const invalid = modules.filter((m) => !MODULES.includes(m))
  if (invalid.length) {
    console.error(`módulo(s) inválido(s): ${invalid.join(', ')} (use: ${MODULES.join(' | ')})`)
    process.exit(1)
  }
  const status = flag('status') ?? 'active'

  // resolve tenant
  let tenantId = target
  if (!UUID_RE.test(target)) {
    const r = await sb.from('tenants').select('id, name').eq('slug', target).maybeSingle()
    if (!r.data) {
      console.error(`tenant com slug "${target}" não encontrado`)
      process.exit(1)
    }
    tenantId = r.data.id
    console.log(`tenant: ${r.data.name} (${tenantId})`)
  }

  const { data, error } = await sb.rpc('set_tenant_entitlement', {
    p_tenant_id: tenantId,
    p_plan: plan,
    p_modules: modules,
    p_status: status,
  })
  if (error) {
    console.error('falhou:', error.message)
    process.exit(1)
  }
  console.log('✅ entitlement definido:', JSON.stringify(data))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
