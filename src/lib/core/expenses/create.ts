import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'

export type ExpenseCategory =
  | 'aluguel'
  | 'equipamentos'
  | 'materiais'
  | 'pessoal'
  | 'servicos'
  | 'impostos'
  | 'manutencao'
  | 'outros'

export type ExpenseFrequency = 'mensal' | 'semanal' | 'anual'

export interface CreateExpenseInput {
  tenantId: string
  category: ExpenseCategory
  description: string
  supplier?: string | null
  amountCents: number
  competenceDate: string
  recurring: boolean
  frequency?: ExpenseFrequency | null
  actorUserId: string
  /**
   * Feature 011 — US3 — vínculo opcional com imposto cadastrado. Se preenchido:
   *   - valida que o imposto existe + está ativo + pertence ao mesmo tenant
   *   - força `category='impostos'` (defense-in-depth com CHECK do DB)
   */
  taxId?: string | null
}

export async function createExpense(
  supabase: SupabaseClient<Database>,
  input: CreateExpenseInput,
) {
  if (input.amountCents <= 0) throw new ValidationError('O valor deve ser maior que zero')
  if (input.description.trim().length < 2) throw new ValidationError('Descrição muito curta')
  if (input.recurring && !input.frequency) {
    throw new ValidationError('Frequência é obrigatória para despesas recorrentes')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.competenceDate)) {
    throw new ValidationError('competence_date deve estar em YYYY-MM-DD')
  }

  let category = input.category
  if (input.taxId) {
    // Confirma existência + ativo + tenant correto (RLS já garante tenant
    // quando rodando sob authenticated; service_role precisa do .eq).
    const { data: tax, error: taxErr } = await supabase
      .from('taxes' as never)
      .select('id, is_active, deleted_at')
      .eq('id', input.taxId)
      .eq('tenant_id', input.tenantId)
      .maybeSingle()
    if (taxErr) throw new Error(`tax lookup failed: ${taxErr.message}`)
    const taxRow = tax as { id: string; is_active: boolean; deleted_at: string | null } | null
    if (!taxRow || taxRow.deleted_at || !taxRow.is_active) {
      throw new ValidationError(
        'Imposto inválido: não encontrado, inativo ou de outra clínica.',
        { taxId: input.taxId },
      )
    }
    category = 'impostos' // FR-015 — força categoria.
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      tenant_id: input.tenantId,
      category,
      description: input.description.trim(),
      supplier: input.supplier?.trim() || null,
      amount_cents: input.amountCents,
      competence_date: input.competenceDate,
      recurring: input.recurring,
      frequency: input.frequency || null,
      created_by: input.actorUserId,
      ...(input.taxId ? { tax_id: input.taxId } : {}),
    } as never)
    .select()
    .single()

  if (error) throw new Error(`createExpense failed: ${error.message}`)
  return data
}
