import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, DomainError } from '@/lib/observability/errors'

/**
 * Cria um codigo personalizado se ainda nao existe (ativo) no tenant; quando
 * o codigo ja existe, retorna o registro existente (reuse). Util quando o
 * fluxo de cadastro de procedimento informa o codigo livremente — em vez de
 * obrigar o usuario a passar pelo /configuracoes/codigos-pessoais.
 */
export interface UpsertCustomCodeInput {
  tenantId: string
  code: string
  description: string
  category?: string | null
  actorUserId: string
}

export interface UpsertCustomCodeResult {
  id: string
  code: string
  description: string
  category: string | null
  reused: boolean
}

export async function upsertCustomCode(
  supabase: SupabaseClient<Database>,
  input: UpsertCustomCodeInput,
): Promise<UpsertCustomCodeResult> {
  const code = input.code.trim()
  const description = input.description.trim()
  if (code.length === 0 || code.length > 50) {
    throw new DomainError(
      'CUSTOM_CODE_INVALID',
      'Codigo personalizado deve ter de 1 a 50 caracteres.',
      { status: 400 },
    )
  }
  if (description.length === 0 || description.length > 200) {
    throw new DomainError(
      'CUSTOM_CODE_DESCRIPTION_INVALID',
      'Descricao do codigo deve ter de 1 a 200 caracteres.',
      { status: 400 },
    )
  }

  // Reuso: codigo ja existe ativo no tenant.
  const existing = await supabase
    .from('custom_procedure_codes' as never)
    .select('id, code, description, category')
    .eq('tenant_id', input.tenantId)
    .eq('code', code)
    .is('deleted_at', null)
    .maybeSingle()
  if (existing.error) {
    throw new Error(`custom_procedure_codes lookup failed: ${existing.error.message}`)
  }
  if (existing.data) {
    const row = existing.data as {
      id: string
      code: string
      description: string
      category: string | null
    }
    return {
      id: row.id,
      code: row.code,
      description: row.description,
      category: row.category,
      reused: true,
    }
  }

  const inserted = (await supabase
    .from('custom_procedure_codes' as never)
    .insert({
      tenant_id: input.tenantId,
      code,
      description,
      category: input.category ?? null,
      created_by: input.actorUserId,
    } as never)
    .select('id, code, description, category')
    .single()) as unknown as {
    data: {
      id: string
      code: string
      description: string
      category: string | null
    } | null
    error: { code?: string; message?: string } | null
  }
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === '23505') {
      throw new ConflictError(
        'CUSTOM_CODE_DUPLICATE',
        `Codigo ${code} ja existe nesta clinica.`,
        { code },
      )
    }
    throw new Error(`upsertCustomCode failed: ${inserted.error?.message ?? 'empty response'}`)
  }
  const row = inserted.data
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    category: row.category,
    reused: false,
  }
}
