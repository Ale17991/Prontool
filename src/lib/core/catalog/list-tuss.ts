import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Busca no catálogo TUSS global. Retorna apenas códigos atualmente
 * vigentes (valid_to IS NULL). Suporta filtro opcional por `tussTable`
 * ('22' procedimentos, '19' materiais, '20' medicamentos, '18' diárias e
 * taxas) usado pelo typeahead de /configuracoes/procedimentos para mostrar só
 * o que bate com o "tipo de item" selecionado pelo admin.
 *
 * Não é tenant-scoped — o catálogo é global e read-only (RLS desabilitado
 * em 0016; o conteúdo vem do pacote oficial da ANS via `pnpm seed:tuss:all`).
 *
 * A busca vai pela RPC `search_tuss_codes` (0194) em vez de montar o filtro
 * aqui: com a Tabela 19 completa são ~1,5 milhão de linhas, e `or=(code.ilike,
 * description.ilike, manufacturer.ilike)` não tem índice que sirva — vira
 * varredura sequencial a cada tecla. A RPC casa com o índice trigram sobre a
 * expressão concatenada e ainda ganha de brinde a busca sem acento.
 */
export type TussTable = '22' | '19' | '20' | '18'

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

interface TussSearchRow {
  code: string
  description: string
  manufacturer: string | null
  tuss_table: string
  tuss_table_label: string | null
  terminology_chapter: string | null
}

export async function searchTussCatalog(
  supabase: SupabaseClient<Database>,
  input: SearchTussInput,
): Promise<TussSearchResult[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const q = (input.query ?? '').trim()

  // `as never`: a RPC é da 0194 e os tipos gerados só a conhecem depois de um
  // `pnpm supabase:gen-types` — mesmo tratamento de set_appointment_material_cost.
  const { data, error } = await supabase.rpc(
    'search_tuss_codes' as never,
    {
      p_query: q || null,
      p_table: input.table ?? null,
      p_limit: limit,
    } as never,
  )
  if (error) throw new Error(`searchTussCatalog failed: ${error.message}`)

  return ((data ?? []) as TussSearchRow[]).map((r) => ({
    code: r.code,
    description: r.description,
    manufacturer: r.manufacturer,
    tussTable: r.tuss_table as TussTable,
    tussTableLabel: r.tuss_table_label,
    terminologyChapter: r.terminology_chapter,
  }))
}
