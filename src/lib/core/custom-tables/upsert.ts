import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, DomainError } from '@/lib/observability/errors'

/**
 * Cria uma tabela personalizada se ainda nao existir (ativa) no tenant;
 * reusa o registro quando o nome ja foi cadastrado. Util para o fluxo
 * inline em /configuracoes/procedimentos onde o usuario pode tipar um
 * nome novo sem passar por uma pagina de gestao dedicada.
 */
export interface UpsertCustomTableInput {
  tenantId: string
  name: string
  description?: string | null
  actorUserId: string
}

export interface UpsertCustomTableResult {
  id: string
  name: string
  description: string | null
  reused: boolean
}

export async function upsertCustomTable(
  supabase: SupabaseClient<Database>,
  input: UpsertCustomTableInput,
): Promise<UpsertCustomTableResult> {
  const name = input.name.trim()
  if (name.length === 0 || name.length > 80) {
    throw new DomainError(
      'CUSTOM_TABLE_INVALID',
      'Nome da tabela personalizada deve ter entre 1 e 80 caracteres.',
      { status: 400 },
    )
  }
  const description = input.description?.trim() ?? null
  if (description !== null && description.length > 300) {
    throw new DomainError(
      'CUSTOM_TABLE_DESCRIPTION_INVALID',
      'Descricao deve ter no maximo 300 caracteres.',
      { status: 400 },
    )
  }

  // Reuse case-insensitive nao se aplica — o unique e por nome literal.
  const existing = await supabase
    .from('custom_procedure_tables' as never)
    .select('id, name, description')
    .eq('tenant_id', input.tenantId)
    .eq('name', name)
    .is('deleted_at', null)
    .maybeSingle()
  if (existing.error) {
    throw new Error(`custom_procedure_tables lookup failed: ${existing.error.message}`)
  }
  if (existing.data) {
    const row = existing.data as { id: string; name: string; description: string | null }
    return { id: row.id, name: row.name, description: row.description, reused: true }
  }

  const inserted = (await supabase
    .from('custom_procedure_tables' as never)
    .insert({
      tenant_id: input.tenantId,
      name,
      description,
      created_by: input.actorUserId,
    } as never)
    .select('id, name, description')
    .single()) as unknown as {
    data: { id: string; name: string; description: string | null } | null
    error: { code?: string; message?: string } | null
  }
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === '23505') {
      throw new ConflictError(
        'CUSTOM_TABLE_DUPLICATE',
        `Tabela "${name}" ja existe nesta clinica.`,
        { name },
      )
    }
    throw new Error(`upsertCustomTable failed: ${inserted.error?.message ?? 'empty response'}`)
  }
  return {
    id: inserted.data.id,
    name: inserted.data.name,
    description: inserted.data.description,
    reused: false,
  }
}
