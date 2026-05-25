import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * T170 — Leitura paginada e exportação CSV/JSON da trilha de auditoria.
 *
 * FR-019: a exportação NÃO pode descartar campos. CSV mantém a ordem
 * abaixo, JSON devolve o objeto por linha sem qualquer transformação
 * além de serialização.
 */
export const AUDIT_FIELDS = [
  'id',
  'tenant_id',
  'actor_id',
  'actor_label',
  'timestamp_utc',
  'entity',
  'entity_id',
  'field',
  'old_value',
  'new_value',
  'reason',
  'ip',
  'user_agent',
  'result',
] as const

export type AuditField = (typeof AUDIT_FIELDS)[number]
export type AuditRow = Record<AuditField, unknown>

export interface AuditFilter {
  tenantId: string
  entity?: string
  actorId?: string
  from?: string
  to?: string
  result?: 'success' | 'denied' | 'conflict'
}

export interface PagedAuditFilter extends AuditFilter {
  cursor?: string | null
  limit?: number
}

export interface PagedAudit {
  entries: AuditRow[]
  nextCursor: string | null
}

export async function listAuditPage(
  supabase: SupabaseClient<Database>,
  filter: PagedAuditFilter,
): Promise<PagedAudit> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500)
  let q = baseQuery(supabase, filter).limit(limit + 1)
  if (filter.cursor) q = q.lt('timestamp_utc', filter.cursor)

  const { data, error } = await q
  if (error) throw new Error(`listAuditPage failed: ${error.message}`)
  const rows = (data ?? []) as unknown as AuditRow[]

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? String(page[page.length - 1]?.timestamp_utc ?? '') : null
  return { entries: page, nextCursor }
}

export async function streamAllAudit(
  supabase: SupabaseClient<Database>,
  filter: AuditFilter,
): Promise<AuditRow[]> {
  // Fetch in batches to avoid postgrest row limits while preserving the
  // append-only ordering. 1k rows per batch keeps memory bounded for
  // typical exports without leaking server memory on huge tenants.
  const BATCH = 1_000
  const out: AuditRow[] = []
  let cursor: string | null = null
  for (;;) {
    let q = baseQuery(supabase, filter).limit(BATCH)
    if (cursor) q = q.lt('timestamp_utc', cursor)
    const { data, error } = await q
    if (error) throw new Error(`streamAllAudit failed: ${error.message}`)
    const rows = (data ?? []) as unknown as AuditRow[]
    if (rows.length === 0) break
    out.push(...rows)
    if (rows.length < BATCH) break
    const last = rows[rows.length - 1]
    cursor = last ? String(last['timestamp_utc'] ?? '') : null
    if (!cursor) break
  }
  return out
}

function baseQuery(supabase: SupabaseClient<Database>, filter: AuditFilter) {
  let q = supabase
    .from('audit_log')
    .select(AUDIT_FIELDS.join(', '))
    .eq('tenant_id', filter.tenantId)
    .order('timestamp_utc', { ascending: false })
  if (filter.entity) q = q.eq('entity', filter.entity)
  if (filter.result) q = q.eq('result', filter.result)
  if (filter.actorId) q = q.eq('actor_id', filter.actorId)
  if (filter.from) q = q.gte('timestamp_utc', filter.from)
  if (filter.to) q = q.lte('timestamp_utc', filter.to)
  return q
}

/**
 * Serializa rows como CSV preservando header com a ordem canônica de
 * AUDIT_FIELDS. Valores nulos viram célula vazia; strings com vírgula,
 * aspas ou quebra de linha são escapadas conforme RFC 4180.
 */
export function rowsToCsv(rows: AuditRow[]): string {
  const lines: string[] = [AUDIT_FIELDS.join(',')]
  for (const row of rows) {
    const cells = AUDIT_FIELDS.map((f) => csvCell(row[f]))
    lines.push(cells.join(','))
  }
  return lines.join('\n') + '\n'
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'string' ? v : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
