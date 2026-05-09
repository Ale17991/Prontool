import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Busca no catálogo TUSS global. Retorna apenas códigos atualmente
 * vigentes (valid_to IS NULL). Suporta filtro opcional por `tussTable`
 * ('22' procedimentos, '19' materiais, '20' medicamentos) usado pelo
 * typeahead de /configuracoes/procedimentos para mostrar só o que bate com
 * o "tipo de item" selecionado pelo admin.
 *
 * Não é tenant-scoped — o catálogo é global e read-only (RLS desabilitado
 * em 0016; o conteúdo veio do catálogo público da ANS via `pnpm seed:tuss`).
 */
export type TussTable = '22' | '19' | '20'

export interface TussSearchResult {
  code: string
  description: string
  manufacturer: string | null
  tussTable: TussTable
  tussTableLabel: string | null
  terminologyChapter: string | null
}

export interface SearchTussInput {
  query?: string
  limit?: number
  table?: TussTable
}

export async function searchTussCatalog(
  supabase: SupabaseClient<Database>,
  input: SearchTussInput,
): Promise<TussSearchResult[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const q = (input.query ?? '').trim()

  let query = supabase
    .from('tuss_codes')
    .select('code, description, manufacturer, tuss_table, tuss_table_label, terminology_chapter')
    .is('valid_to', null)
    .order('code', { ascending: true })
    .limit(limit)

  if (input.table) query = query.eq('tuss_table', input.table)

  if (q) {
    // PostgREST `or` filter: code starts with q OR description ilike %q%
    // OR manufacturer ilike %q% (pra achar "abbott" em materiais/medicamentos).
    // Escapamos vírgulas/parênteses pra não quebrar a sintaxe do filtro.
    const safe = q.replace(/[(),]/g, ' ')
    query = query.or(
      `code.ilike.${safe}%,description.ilike.%${safe}%,manufacturer.ilike.%${safe}%`,
    )
  }

  const { data, error } = await query
  if (error) throw new Error(`searchTussCatalog failed: ${error.message}`)

  return (data ?? []).map((r) => ({
    code: r.code,
    description: r.description,
    manufacturer: r.manufacturer,
    tussTable: r.tuss_table as TussTable,
    tussTableLabel: r.tuss_table_label,
    terminologyChapter: r.terminology_chapter,
  }))
}
