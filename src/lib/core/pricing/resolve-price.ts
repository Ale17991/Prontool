import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { AppointmentPriceMissingError } from '@/lib/observability/errors'
import { getTenantTimezone, dateToTenantYmd } from '@/lib/utils/tenant-tz'

/**
 * T079 — resolve the price row that was "active" for a (procedure, plan)
 * combination at a given moment. The caller normally passes the appointment
 * date so the frozen snapshot stays stable even after future price changes.
 *
 * Selection rule: the newest `price_versions` row whose `valid_from <= asOf`.
 * Ties are broken by `created_at DESC` (later-inserted wins within a day).
 * Raises `AppointmentPriceMissingError` when no row qualifies — the worker
 * maps that onto DLQ with actionable `detail`.
 */
export interface ResolvePriceInput {
  tenantId: string
  procedureId: string
  planId: string
  asOf: Date
}

export interface ResolvedPrice {
  priceVersionId: string
  amountCents: number
  validFrom: string
}

export async function resolvePrice(
  supabase: SupabaseClient<Database>,
  input: ResolvePriceInput,
): Promise<ResolvedPrice> {
  // Camada 3 T3 — asOf é um instante absoluto (Date). Convertemos para a
  // data do calendário no fuso do tenant antes de comparar com `valid_from`.
  // Antes: `input.asOf.toISOString().slice(0, 10)` dava a data UTC, fazendo
  // agendamento às 22:30 BRT pegar `price_version` do dia SEGUINTE.
  const tz = await getTenantTimezone(supabase, input.tenantId)
  const asOfDate = dateToTenantYmd(input.asOf, tz)
  const { data, error } = await supabase
    .from('price_versions')
    .select('id, amount_cents, valid_from, created_at')
    .eq('tenant_id', input.tenantId)
    .eq('procedure_id', input.procedureId)
    .eq('plan_id', input.planId)
    .lte('valid_from', asOfDate)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`resolvePrice query failed: ${error.message}`)
  if (!data) {
    throw new AppointmentPriceMissingError({
      tenant_id: input.tenantId,
      procedure_id: input.procedureId,
      plan_id: input.planId,
      as_of: asOfDate,
    })
  }
  return {
    priceVersionId: data.id,
    amountCents: data.amount_cents,
    validFrom: data.valid_from,
  }
}

/**
 * Non-throwing variant for UI paths where "no price yet" is a legitimate
 * state (e.g. treatment-plan estimates). Returns null when nothing matches.
 */
export async function tryResolvePrice(
  supabase: SupabaseClient<Database>,
  input: ResolvePriceInput,
): Promise<ResolvedPrice | null> {
  try {
    return await resolvePrice(supabase, input)
  } catch (err) {
    if (err instanceof AppointmentPriceMissingError) return null
    throw err
  }
}
