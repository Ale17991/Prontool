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

/** PostgREST devolve no máximo 1000 linhas por resposta. */
const PAGE = 1000

async function scanDeprecated(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
): Promise<DeprecatedGroup[]> {
  const procedures = await fetchAllProcedures(supabase)

  // Só os códigos efetivamente em uso — e não "todos os aposentados do
  // catálogo". O PostgREST devolve no máximo 1000 linhas por resposta, e a
  // consulta anterior pedia a lista inteira sem paginar: bastava a ANS aposentar
  // mais de mil códigos para o scan passar a concluir, em silêncio, que quase
  // nada tinha sido aposentado. Perguntar pelos códigos em uso troca um teto
  // que depende do catálogo por um que depende do que a clínica cadastrou.
  const inUse = [
    ...new Set(
      procedures
        .map((p) => p.tuss_code)
        // Procedimentos "não listados" (migration 0066) não têm tuss_code —
        // não há TUSS para depreciar.
        .filter((c): c is string => typeof c === 'string' && c.length > 0),
    ),
  ]

  const retiredMap = await fetchRetiredAmong(supabase, inUse)

  const groups = new Map<string, DeprecatedGroup>()
  for (const p of procedures) {
    if (!p.tuss_code) continue
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

interface ProcedureRow {
  tenant_id: string
  tuss_code: string | null
  id: string
}

async function fetchAllProcedures(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
): Promise<ProcedureRow[]> {
  const out: ProcedureRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('procedures')
      .select('tenant_id, tuss_code, id')
      .eq('active', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...((data ?? []) as ProcedureRow[]))
    if (!data || data.length < PAGE) return out
  }
}

/** Mapa code → valid_to, restrito aos códigos passados e já aposentados. */
async function fetchRetiredAmong(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  codes: string[],
): Promise<Map<string, string>> {
  const today = new Date().toISOString().slice(0, 10)
  const map = new Map<string, string>()
  // `in.(...)` vai na query string: fatiar mantém a URL longe do limite do
  // servidor mesmo numa base com muitos procedimentos cadastrados.
  const CHUNK = 200
  for (let i = 0; i < codes.length; i += CHUNK) {
    const slice = codes.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('tuss_codes')
      .select('code, valid_to')
      .in('code', slice)
      .not('valid_to', 'is', null)
      .lt('valid_to', today)
    if (error) throw error
    for (const r of data ?? []) {
      if (r.valid_to) map.set(r.code, r.valid_to)
    }
  }
  return map
}
