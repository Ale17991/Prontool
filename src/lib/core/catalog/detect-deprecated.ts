import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { dispatchAlert } from '@/lib/core/alerts/dispatcher'
import { logger } from '@/lib/observability/logger'

/**
 * Scans every tenant's procedures for TUSS codes that are now retired
 * (tuss_codes.valid_to IS NOT NULL). For each (tenant_id, tuss_code)
 * combination affected, emits one deduplicated alert of type
 * `tuss_deprecated`.
 *
 * Called by scripts/seed-tuss.ts at the end of each catalog refresh
 * (T032b) and exposed as a standalone utility for manual runs.
 *
 * Implementation note: this is a client-side join rather than a SQL RPC.
 * Keeping the logic in TS lets us evolve it without a migration; a
 * materialised view is a future optimisation if the scan becomes hot.
 */
export async function detectDeprecatedTussCodes(): Promise<{
  scanned: number
  alerts: number
}> {
  const supabase = createSupabaseServiceClient()
  const rows = await scanDeprecated(supabase)

  let alertCount = 0
  for (const row of rows) {
    const result = await dispatchAlert({
      tenantId: row.tenant_id,
      type: 'tuss_deprecated',
      subjectRef: { tuss_code: row.tuss_code },
      detail: {
        tuss_code: row.tuss_code,
        retired_on: row.retired_on,
        procedure_count: row.procedure_ids.length,
        action: 'review-and-deactivate',
      },
    })
    if (!result.deduped) alertCount += 1
  }

  logger.info({ scanned: rows.length, alerts: alertCount }, 'tuss-deprecation-scan-complete')
  return { scanned: rows.length, alerts: alertCount }
}

interface DeprecatedGroup {
  tenant_id: string
  tuss_code: string
  retired_on: string
  procedure_ids: string[]
}

async function scanDeprecated(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
): Promise<DeprecatedGroup[]> {
  const { data, error } = await supabase
    .from('procedures')
    .select('tenant_id, tuss_code, id')
    .eq('active', true)
  if (error) throw error
  const { data: retired, error: retErr } = await supabase
    .from('tuss_codes')
    .select('code, valid_to')
    .not('valid_to', 'is', null)
    .lt('valid_to', new Date().toISOString().slice(0, 10))
  if (retErr) throw retErr
  const retiredMap = new Map<string, string>()
  for (const r of retired) {
    if (r.valid_to) retiredMap.set(r.code, r.valid_to)
  }

  const groups = new Map<string, DeprecatedGroup>()
  for (const p of data) {
    const retiredOn = retiredMap.get(p.tuss_code)
    if (!retiredOn) continue
    const key = `${p.tenant_id}::${p.tuss_code}`
    const existing = groups.get(key)
    if (existing) {
      existing.procedure_ids.push(p.id)
    } else {
      groups.set(key, {
        tenant_id: p.tenant_id,
        tuss_code: p.tuss_code,
        retired_on: retiredOn,
        procedure_ids: [p.id],
      })
    }
  }
  return [...groups.values()]
}
