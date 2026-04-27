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

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      tenant_id: input.tenantId,
      category: input.category,
      description: input.description.trim(),
      supplier: input.supplier?.trim() || null,
      amount_cents: input.amountCents,
      competence_date: input.competenceDate,
      recurring: input.recurring,
      frequency: input.frequency || null,
      created_by: input.actorUserId,
    })
    .select()
    .single()

  if (error) throw new Error(`createExpense failed: ${error.message}`)
  return data
}
