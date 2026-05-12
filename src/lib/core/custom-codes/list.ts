import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Codigos de procedimento personalizados por clinica (migration 0072).
 * Cada tenant gerencia seus proprios; nao colidem com TUSS.
 */
export interface CustomProcedureCode {
  id: string
  code: string
  description: string
  category: string | null
  createdAt: string
  createdBy: string
}

/**
 * Lista codigos personalizados ativos do tenant (deleted_at IS NULL).
 * Ordenacao: code ASC (UI espera busca incremental no typeahead).
 */
export async function listCustomCodes(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; includeDeleted?: boolean },
): Promise<CustomProcedureCode[]> {
  let q = supabase
    .from('custom_procedure_codes' as never)
    .select('id, code, description, category, created_at, created_by, deleted_at')
    .eq('tenant_id', args.tenantId)
    .order('code', { ascending: true })

  if (!args.includeDeleted) {
    q = q.is('deleted_at', null)
  }

  const { data, error } = await q
  if (error) {
    if (/relation .*custom_procedure_codes.* does not exist/i.test(error.message)) {
      return []
    }
    throw new Error(`listCustomCodes failed: ${error.message}`)
  }

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    code: r.code as string,
    description: r.description as string,
    category: (r.category as string | null) ?? null,
    createdAt: r.created_at as string,
    createdBy: r.created_by as string,
  }))
}
