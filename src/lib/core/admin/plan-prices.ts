import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { Plan } from '@/lib/core/entitlements/plans'
import { ValidationError } from '@/lib/observability/errors'
import { logger } from '@/lib/observability/logger'

/**
 * Feature 044 — preços de plano (config global, base do MRR).
 * `plan_prices` é tabela nova; tipos gerados só após `supabase:gen-types`,
 * daí o cast `as never` no nome da tabela (padrão do projeto).
 */
const PLANS: Plan[] = ['essencial', 'pro', 'clinica', 'legacy']

export type PlanPrices = Record<Plan, number>

export async function getPlanPrices(supabase: SupabaseClient<Database>): Promise<PlanPrices> {
  const out: PlanPrices = { essencial: 0, pro: 0, clinica: 0, legacy: 0 }
  const { data, error } = await supabase.from('plan_prices' as never).select('plan, price_cents')
  if (error) {
    logger.error({ err: error.message }, 'getPlanPrices failed')
    return out
  }
  for (const r of (data ?? []) as unknown as Array<{ plan: string; price_cents: number }>) {
    if ((PLANS as string[]).includes(r.plan)) out[r.plan as Plan] = Number(r.price_cents) || 0
  }
  return out
}

/**
 * Define o preço de um plano (centavos ≥ 0). Restrito a super-admin (validado
 * na action). Registra a mudança no logger de plataforma (audit_log é
 * tenant-scoped e não se aplica a config global) + updated_by/updated_at.
 */
export async function setPlanPrice(
  supabase: SupabaseClient<Database>,
  actorId: string,
  plan: Plan,
  priceCents: number,
): Promise<void> {
  if (!PLANS.includes(plan)) throw new ValidationError('Plano inválido.')
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new ValidationError('Preço inválido (centavos inteiros ≥ 0).')
  }

  const cur = await supabase
    .from('plan_prices' as never)
    .select('price_cents')
    .eq('plan', plan)
    .maybeSingle()
  const oldCents = (cur.data as { price_cents?: number } | null)?.price_cents ?? 0

  const { error } = await supabase.from('plan_prices' as never).upsert(
    {
      plan,
      price_cents: priceCents,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: 'plan' },
  )
  if (error) throw new Error(`setPlanPrice failed: ${error.message}`)

  logger.info(
    { event: 'plan_price.changed', actor_id: actorId, plan, old_cents: oldCents, new_cents: priceCents },
    'plan-price-changed',
  )
}
