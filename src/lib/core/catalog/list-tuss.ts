import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Busca no catálogo TUSS global. Retorna apenas códigos atualmente
 * vigentes (valid_to IS NULL) ordenados por relevância:
 *   1) match exato no `code` no topo
 *   2) prefixo do `code`
 *   3) substring na `description`
 *
 * Usado pelo typeahead da tela `/cadastros/procedimentos` quando o admin vai
 * cadastrar um procedimento novo. Não é tenant-scoped — o catálogo é
 * global e read-only (RLS deliberadamente desabilitado em 0028; o
 * conteúdo veio do catálogo público da ANS via `pnpm seed:tuss`).
 */
export interface TussSearchResult {
  code: string
  description: string
  terminologyChapter: string | null
}

export interface SearchTussInput {
  query?: string
  limit?: number
}

export async function searchTussCatalog(
  supabase: SupabaseClient<Database>,
  input: SearchTussInput,
): Promise<TussSearchResult[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const q = (input.query ?? '').trim()

  let query = supabase
    .from('tuss_codes')
    .select('code, description, terminology_chapter')
    .is('valid_to', null)
    .order('code', { ascending: true })
    .limit(limit)

  if (q) {
    // PostgREST `or` filter: code starts with q OR description ilike %q%
    // We escape commas/parentheses to avoid breaking the filter syntax.
    const safe = q.replace(/[(),]/g, ' ')
    query = query.or(`code.ilike.${safe}%,description.ilike.%${safe}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(`searchTussCatalog failed: ${error.message}`)

  return (data ?? []).map((r) => ({
    code: r.code,
    description: r.description,
    terminologyChapter: r.terminology_chapter,
  }))
}
