import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError } from '@/lib/observability/errors'

/**
 * T021 — Feature 011 — cria um imposto da clínica.
 *
 * Regras:
 *  - Nome único (case-insensitive, trim) por tenant entre os não deletados
 *    (UNIQUE INDEX `taxes_active_name_unique_idx`). Colisão → ConflictError
 *    (`TAX_DUPLICATE`) mapeado para HTTP 409 pela camada de rota.
 *  - rate_bps deve estar em [0, 10000] — CHECK no DB; defesa redundante na app.
 *  - category é enum {municipal, estadual, federal, outro}.
 */
export type TaxCategory = 'municipal' | 'estadual' | 'federal' | 'outro'

export interface CreateTaxInput {
  tenantId: string
  name: string
  rateBps: number
  category: TaxCategory
  description?: string | null
  actorUserId: string
}

export interface TaxRow {
  id: string
  tenant_id: string
  name: string
  rate_bps: number
  description: string | null
  category: TaxCategory
  is_active: boolean
  created_at: string
  created_by: string
  deleted_at: string | null
  deleted_by: string | null
}

export async function createTax(
  supabase: SupabaseClient<Database>,
  input: CreateTaxInput,
): Promise<TaxRow> {
  const { data, error } = await supabase
    // `taxes` é tabela nova (migration 0076); pode ainda não estar no
    // `Database` gerado quando esta linha for compilada antes do
    // `pnpm supabase:gen-types`. O cast mantém a chamada idiomática.
    .from('taxes' as never)
    .insert({
      tenant_id: input.tenantId,
      name: input.name.trim(),
      rate_bps: input.rateBps,
      category: input.category,
      description: input.description?.trim() || null,
      created_by: input.actorUserId,
    } as never)
    .select(
      'id, tenant_id, name, rate_bps, description, category, is_active, created_at, created_by, deleted_at, deleted_by',
    )
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ConflictError(
        'TAX_DUPLICATE',
        `Já existe um imposto com o nome "${input.name.trim()}".`,
        { name: input.name.trim() },
      )
    }
    throw new Error(`createTax failed: ${error.message}`)
  }
  return data as unknown as TaxRow
}
