import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'

export interface CashBalanceAdjustmentRow {
  id: string
  effectiveFrom: string
  amountCents: number
  reason: string
  actorUserId: string
  createdAt: string
}

interface DbRow {
  id: string
  effective_from: string
  amount_cents: number
  reason: string
  actor_user_id: string
  created_at: string
}

function toDto(r: DbRow): CashBalanceAdjustmentRow {
  return {
    id: r.id,
    effectiveFrom: r.effective_from,
    amountCents: Number(r.amount_cents),
    reason: r.reason,
    actorUserId: r.actor_user_id,
    createdAt: r.created_at,
  }
}

export async function listCashBalanceAdjustments(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; limit?: number },
): Promise<CashBalanceAdjustmentRow[]> {
  const { data, error } = await supabase
    .from('tenant_cash_balance_adjustments' as never)
    .select('*')
    .eq('tenant_id', args.tenantId)
    .order('effective_from', { ascending: false })
    .limit(args.limit ?? 50)
  if (error) throw new Error(`list cash balance: ${error.message}`)
  return ((data ?? []) as unknown as DbRow[]).map(toDto)
}

export async function addCashBalanceAdjustment(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    effectiveFrom: string
    amountCents: number
    reason: string
    actorUserId: string
  },
): Promise<CashBalanceAdjustmentRow> {
  if (args.amountCents === 0) throw new ValidationError('amount_cents must be != 0')
  if (args.reason.trim().length < 3)
    throw new ValidationError('reason must be at least 3 chars')

  const ins = await supabase
    .from('tenant_cash_balance_adjustments' as never)
    .insert({
      tenant_id: args.tenantId,
      effective_from: args.effectiveFrom,
      amount_cents: args.amountCents,
      reason: args.reason,
      actor_user_id: args.actorUserId,
    } as never)
    .select('*')
    .single()
  if (ins.error) throw new Error(`add cash balance: ${ins.error.message}`)

  await supabase.rpc('log_audit_event' as never, {
    p_tenant_id: args.tenantId,
    p_entity: 'tenant_cash_balance_adjustments',
    p_entity_id: (ins.data as { id: string }).id,
    p_field: 'amount_cents',
    p_old: null,
    p_new: args.amountCents.toString(),
    p_reason: args.reason,
  } as never)

  return toDto(ins.data as unknown as DbRow)
}

export async function tenantCashBalanceAt(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; date: string },
): Promise<number> {
  const { data, error } = await supabase.rpc('tenant_cash_balance_at' as never, {
    p_tenant_id: args.tenantId,
    p_date: args.date,
  } as never)
  if (error) throw new Error(`cash balance at: ${error.message}`)
  return Number(data ?? 0)
}
