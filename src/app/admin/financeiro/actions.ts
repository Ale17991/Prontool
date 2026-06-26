'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { superAdminUserId } from '@/lib/auth/platform-admin'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { setPlanPrice } from '@/lib/core/admin/plan-prices'
import type { Plan } from '@/lib/core/entitlements/plans'
import type { Database } from '@/lib/db/types'

/** Feature 044 (US1) — super-admin define o preço mensal de um plano. */
export async function adminSetPlanPriceAction(
  plan: Plan,
  priceCents: number,
): Promise<{ ok: boolean; error?: string }> {
  const actorId = await superAdminUserId()
  if (!actorId) return { ok: false, error: 'Não autorizado.' }
  try {
    const sb = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
    await setPlanPrice(sb, actorId, plan, priceCents)
    revalidatePath('/admin', 'layout')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erro ao salvar preço.' }
  }
}
