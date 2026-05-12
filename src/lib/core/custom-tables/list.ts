import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Tabelas personalizadas de procedimentos (migration 0075). Cada tenant
 * gerencia suas proprias categorias para agrupar procedimentos nao listados.
 */
export interface CustomProcedureTable {
  id: string
  name: string
  description: string | null
  createdAt: string
  createdBy: string
}

/**
 * Lista tabelas personalizadas ativas (deleted_at IS NULL) do tenant.
 * Ordenacao alfabetica por nome.
 */
export async function listCustomTables(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string },
): Promise<CustomProcedureTable[]> {
  const { data, error } = await supabase
    .from('custom_procedure_tables' as never)
    .select('id, name, description, created_at, created_by, deleted_at')
    .eq('tenant_id', args.tenantId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) {
    if (/relation .*custom_procedure_tables.* does not exist/i.test(error.message)) {
      return []
    }
    throw new Error(`listCustomTables failed: ${error.message}`)
  }

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    createdAt: r.created_at as string,
    createdBy: r.created_by as string,
  }))
}
