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
 */
export async function detectDeprecatedTussCodes(): Promise<{
  scanned: number
  alerts: number
}> {
  const supabase = createSupabaseServiceClient()

  const { data, error } = await supabase.rpc('scan_deprecated_tuss_in_tenants').select('*')
  if (error) {
    // Fallback: raw SQL-equivalent via view-style join. The RPC above is
    // optional — if not defined in migrations, do the join client-side.
    logger.info({ err: error.message }, 'scan_deprecated_tuss_rpc_missing-falling-back')
  }

  const rows = data ?? (await fallbackScan(supabase))

  let alertCount = 0
  for (const row of rows) {
    const r = row as { tenant_id: string; tuss_code: string; retired_on: string; procedure_ids: string[] }
    const result = await dispatchAlert({
      tenantId: r.tenant_id,
      type: 'tuss_deprecated',
      subjectRef: { tuss_code: r.tuss_code },
      detail: {
        tuss_code: r.tuss_code,
        retired_on: r.retired_on,
        procedure_count: r.procedure_ids?.length ?? 0,
        action: 'review-and-deactivate',
      },
    })
    if (!result.deduped) alertCount += 1
  }

  logger.info({ scanned: rows.length, alerts: alertCount }, 'tuss-deprecation-scan-complete')
  return { scanned: rows.length, alerts: alertCount }
}

async function fallbackScan(supabase: ReturnType<typeof createSupabaseServiceClient>) {
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
  const retiredMap = new Map(retired.map((r) => [r.code, r.valid_to]))

  const groups = new Map<string, { tenant_id: string; tuss_code: string; retired_on: string; procedure_ids: string[] }>()
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
