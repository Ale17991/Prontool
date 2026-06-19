import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import type { ExpenseCategory, ExpenseFrequency } from './create'

export interface CorrectExpenseInput {
  id: string
  tenantId: string
  actorUserId: string
  category: ExpenseCategory
  description: string
  supplier?: string | null
  amountCents: number
  competenceDate: string
  recurring: boolean
  frequency?: ExpenseFrequency | null
}

/**
 * "Editar" despesa preservando a trilha financeira (decisão do usuário):
 * a despesa é imutável (trigger 0028), então a correção cria uma NOVA despesa
 * com os dados corrigidos e faz soft-delete da antiga. Os comprovantes ativos
 * são re-vinculados à nova. Tudo via service-role (bypassa o trigger) + audit.
 *
 * Ordem: insere a nova primeiro; se o soft-delete da antiga falhar, compensa
 * apagando a nova (evita duas despesas ativas = dupla contagem no financeiro).
 */
export async function correctExpense(
  supabase: SupabaseClient<Database>,
  input: CorrectExpenseInput,
): Promise<{ id: string }> {
  if (input.amountCents <= 0) throw new ValidationError('O valor deve ser maior que zero')
  if (input.description.trim().length < 2) throw new ValidationError('Descrição muito curta')
  if (input.recurring && !input.frequency) {
    throw new ValidationError('Frequência é obrigatória para despesas recorrentes')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.competenceDate)) {
    throw new ValidationError('competence_date deve estar em YYYY-MM-DD')
  }

  // Carrega a despesa atual (ativa) — herda tax_id e created_at original p/ ref.
  const { data: oldRow, error: loadErr } = await supabase
    .from('expenses')
    .select('id, tenant_id, tax_id, deleted_at')
    .eq('id', input.id)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (loadErr) throw new Error(`correctExpense load failed: ${loadErr.message}`)
  const old = oldRow as { id: string; tax_id: string | null; deleted_at: string | null } | null
  if (!old || old.deleted_at) throw new NotFoundError('expenses', input.id)

  // Despesa vinculada a imposto mantém categoria 'impostos' (FR-015 / coerência).
  const taxId = old.tax_id ?? null
  const category: ExpenseCategory = taxId ? 'impostos' : input.category

  // 1) Insere a versão corrigida.
  const { data: created, error: insErr } = await supabase
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
      ...(taxId ? { tax_id: taxId } : {}),
    } as never)
    .select('id')
    .single()
  if (insErr) throw new Error(`correctExpense insert failed: ${insErr.message}`)
  const newId = (created as { id: string }).id

  // 2) Soft-delete da antiga; se falhar, compensa apagando a nova.
  const { error: delErr } = await supabase
    .from('expenses')
    .update({ deleted_at: new Date().toISOString(), deleted_by: input.actorUserId } as never)
    .eq('id', input.id)
    .eq('tenant_id', input.tenantId)
    .is('deleted_at', null)
  if (delErr) {
    await supabase
      .from('expenses')
      .update({ deleted_at: new Date().toISOString(), deleted_by: input.actorUserId } as never)
      .eq('id', newId)
      .eq('tenant_id', input.tenantId)
    throw new Error(`correctExpense soft-delete failed (revertido): ${delErr.message}`)
  }

  // 3) Re-vincula comprovantes ativos da antiga para a nova (best-effort).
  const { error: recErr } = await supabase
    .from('expense_receipts')
    .update({ expense_id: newId } as never)
    .eq('tenant_id', input.tenantId)
    .eq('expense_id', input.id)
    .is('deleted_at', null)
  if (recErr) {
    // Não derruba a correção — comprovantes ficam na despesa antiga (recuperável).
    console.error('correctExpense receipt re-link failed', { from: input.id, to: newId, error: recErr })
  }

  // 4) Auditoria.
  await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorUserId,
    actor_label: null,
    entity: 'expenses',
    entity_id: newId,
    field: 'correction',
    old_value: input.id,
    new_value: newId,
    reason: 'edição (correção) via /api/despesas PUT',
    result: 'success',
  } as never)

  return { id: newId }
}
