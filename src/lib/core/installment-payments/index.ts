import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError, NotFoundError } from '@/lib/observability/errors'

export interface InstallmentPaymentDTO {
  id: string
  installmentId: string
  paidAt: string
  amountCents: number
  paymentMethod: string
  note: string | null
  actorUserId: string
  createdAt: string
}

interface DbRow {
  id: string
  tenant_id: string
  installment_id: string
  paid_at: string
  amount_cents: number
  payment_method: string
  note: string | null
  actor_user_id: string
  created_at: string
}

function toDto(r: DbRow): InstallmentPaymentDTO {
  return {
    id: r.id,
    installmentId: r.installment_id,
    paidAt: r.paid_at,
    amountCents: Number(r.amount_cents),
    paymentMethod: r.payment_method,
    note: r.note,
    actorUserId: r.actor_user_id,
    createdAt: r.created_at,
  }
}

export interface RecordPaymentInput {
  tenantId: string
  installmentId: string
  amountCents: number
  paymentMethod: string
  paidAt: string
  note?: string | null
  actorUserId: string
}

export async function recordInstallmentPayment(
  supabase: SupabaseClient<Database>,
  input: RecordPaymentInput,
): Promise<InstallmentPaymentDTO> {
  if (input.amountCents <= 0) {
    throw new ValidationError('amount_cents must be > 0')
  }

  // Verifica pendente atual via SELECT da parcela
  const sel = await supabase
    .from('payment_installments' as never)
    .select('amount_cents, paid_amount_cents, tenant_id')
    .eq('id', input.installmentId)
    .maybeSingle()
  if (sel.error) throw new Error(`installment lookup: ${sel.error.message}`)
  const row = sel.data as
    | { amount_cents: number; paid_amount_cents: number; tenant_id: string }
    | null
  if (!row) throw new NotFoundError('installment', input.installmentId)
  if (row.tenant_id !== input.tenantId) {
    throw new NotFoundError('installment', input.installmentId)
  }
  const pending = Number(row.amount_cents) - Number(row.paid_amount_cents)
  if (input.amountCents > pending) {
    throw new ValidationError(
      `amount_cents (${input.amountCents}) exceeds pending (${pending})`,
    )
  }

  const ins = await supabase
    .from('installment_payments' as never)
    .insert({
      tenant_id: input.tenantId,
      installment_id: input.installmentId,
      paid_at: input.paidAt,
      amount_cents: input.amountCents,
      payment_method: input.paymentMethod,
      note: input.note ?? null,
      actor_user_id: input.actorUserId,
    } as never)
    .select('*')
    .single()
  if (ins.error) throw new Error(`record installment payment: ${ins.error.message}`)
  return toDto(ins.data as unknown as DbRow)
}

export interface ReversePaymentInput {
  tenantId: string
  installmentId: string
  paymentId: string
  reason: string
  actorUserId: string
}

export async function reverseInstallmentPayment(
  supabase: SupabaseClient<Database>,
  input: ReversePaymentInput,
): Promise<InstallmentPaymentDTO> {
  if (input.reason.trim().length < 10) {
    throw new ValidationError('reason must be at least 10 characters')
  }
  const orig = await supabase
    .from('installment_payments' as never)
    .select('amount_cents, payment_method, tenant_id, installment_id')
    .eq('id', input.paymentId)
    .maybeSingle()
  if (orig.error) throw new Error(`original lookup: ${orig.error.message}`)
  const o = orig.data as
    | {
        amount_cents: number
        payment_method: string
        tenant_id: string
        installment_id: string
      }
    | null
  if (!o) throw new NotFoundError('installment_payment', input.paymentId)
  if (o.tenant_id !== input.tenantId || o.installment_id !== input.installmentId) {
    throw new NotFoundError('installment_payment', input.paymentId)
  }

  const ins = await supabase
    .from('installment_payments' as never)
    .insert({
      tenant_id: input.tenantId,
      installment_id: input.installmentId,
      paid_at: new Date().toISOString(),
      amount_cents: -Math.abs(Number(o.amount_cents)),
      payment_method: o.payment_method,
      note: `Estorno: ${input.reason}`,
      actor_user_id: input.actorUserId,
    } as never)
    .select('*')
    .single()
  if (ins.error) throw new Error(`reverse installment payment: ${ins.error.message}`)
  return toDto(ins.data as unknown as DbRow)
}

export async function listPaymentsForInstallment(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; installmentId: string },
): Promise<InstallmentPaymentDTO[]> {
  const { data, error } = await supabase
    .from('installment_payments' as never)
    .select('*')
    .eq('tenant_id', args.tenantId)
    .eq('installment_id', args.installmentId)
    .order('paid_at', { ascending: false })
  if (error) throw new Error(`list installment payments: ${error.message}`)
  return ((data ?? []) as unknown as DbRow[]).map(toDto)
}
