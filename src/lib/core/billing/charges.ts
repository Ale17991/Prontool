/**
 * Espelho local das cobranças da assinatura (D2 da 0212).
 *
 * A VERDADE É O ASAAS. Nada aqui decide se entrou dinheiro; tudo é reflexo do
 * que o gateway contou, seja por webhook seja por reconciliação. Por isso toda
 * escrita é UPSERT por `asaas_payment_id` e nunca INSERT cego: webhook e
 * reconciliação chegam pelo mesmo caminho e não podem duplicar a fatura.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { reaisToCents } from './asaas/money'
import type { AsaasPayment, ChargeStatus } from './asaas/types'
import { mapAsaasStatus } from './status'

export interface BillingCharge {
  id: string
  tenantId: string
  asaasPaymentId: string
  amountCents: number
  netAmountCents: number | null
  status: ChargeStatus
  billingType: string | null
  dueDate: string
  paidAt: string | null
  invoiceUrl: string | null
  bankSlipUrl: string | null
  partnerId: string | null
  splitAmountCents: number | null
}

interface ChargeRow {
  id: string
  tenant_id: string
  asaas_payment_id: string
  amount_cents: number
  net_amount_cents: number | null
  status: string
  billing_type: string | null
  due_date: string
  paid_at: string | null
  invoice_url: string | null
  bank_slip_url: string | null
  partner_id: string | null
  split_amount_cents: number | null
}

const COLUMNS =
  'id, tenant_id, asaas_payment_id, amount_cents, net_amount_cents, status, billing_type, due_date, paid_at, invoice_url, bank_slip_url, partner_id, split_amount_cents'

function mapRow(r: ChargeRow): BillingCharge {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    asaasPaymentId: r.asaas_payment_id,
    amountCents: r.amount_cents,
    netAmountCents: r.net_amount_cents,
    status: r.status as ChargeStatus,
    billingType: r.billing_type,
    dueDate: r.due_date,
    paidAt: r.paid_at,
    invoiceUrl: r.invoice_url,
    bankSlipUrl: r.bank_slip_url,
    partnerId: r.partner_id,
    splitAmountCents: r.split_amount_cents,
  }
}

/**
 * Grava (ou atualiza) a cobrança a partir do que o Asaas devolveu.
 *
 * `partnerId`/`splitAmountCents` só são gravados quando informados — o webhook
 * de uma cobrança já existente não os conhece, e sobrescrevê-los com `null`
 * apagaria o SNAPSHOT do split que a emissão registrou (D3).
 */
export async function upsertChargeFromAsaas(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  payment: AsaasPayment,
  snapshot?: { partnerId: string | null; splitAmountCents: number | null },
): Promise<ChargeStatus> {
  const status = mapAsaasStatus(payment.status)
  const paidOn = payment.paymentDate ?? payment.clientPaymentDate ?? null

  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    asaas_payment_id: payment.id,
    asaas_subscription_id: payment.subscription ?? null,
    amount_cents: reaisToCents(payment.value) ?? 0,
    net_amount_cents: reaisToCents(payment.netValue),
    status,
    billing_type: payment.billingType ?? null,
    due_date: payment.dueDate,
    // `paymentDate` vem como YYYY-MM-DD; o `paid_at` é TIMESTAMPTZ. Deixamos o
    // Postgres interpretar a data — a hora exata do pagamento não é informada
    // pelo Asaas neste campo, e inventar meia-noite UTC seria pior que a data.
    paid_at: paidOn,
    invoice_url: payment.invoiceUrl ?? null,
    bank_slip_url: payment.bankSlipUrl ?? null,
  }
  if (snapshot) {
    row.partner_id = snapshot.partnerId
    row.split_amount_cents = snapshot.splitAmountCents
  }

  const { error } = await supabase
    .from('billing_charges' as never)
    .upsert(row as never, { onConflict: 'asaas_payment_id' })
  if (error) throw new Error(`upsertChargeFromAsaas failed: ${error.message}`)
  return status
}

/** Faturas de uma clínica, mais recentes primeiro. */
export async function listChargesForTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  limit = 24,
): Promise<BillingCharge[]> {
  const { data, error } = await supabase
    .from('billing_charges' as never)
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .order('due_date', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listChargesForTenant failed: ${error.message}`)
  return ((data ?? []) as unknown as ChargeRow[]).map(mapRow)
}

export async function getChargeByAsaasId(
  supabase: SupabaseClient<Database>,
  asaasPaymentId: string,
): Promise<BillingCharge | null> {
  const { data, error } = await supabase
    .from('billing_charges' as never)
    .select(COLUMNS)
    .eq('asaas_payment_id', asaasPaymentId)
    .maybeSingle()
  if (error) throw new Error(`getChargeByAsaasId failed: ${error.message}`)
  return data ? mapRow(data as unknown as ChargeRow) : null
}

/**
 * Quanto cada parceiro tem a receber/recebeu num período.
 *
 * Soma o SNAPSHOT gravado na emissão, nunca a regra atual do parceiro (D3):
 * mudar o percentual hoje não pode reescrever o que já foi dividido no mês
 * passado. Só entra o que o cliente efetivamente pagou — split de fatura
 * pendente é expectativa, não repasse.
 */
export async function partnerSplitTotals(
  supabase: SupabaseClient<Database>,
  opts: { partnerId?: string; from?: string; to?: string } = {},
): Promise<Array<{ partnerId: string; charges: number; splitCents: number; grossCents: number }>> {
  let q = supabase
    .from('billing_charges' as never)
    .select('partner_id, split_amount_cents, amount_cents, status, due_date')
    .not('partner_id', 'is', null)
    .in('status', ['confirmado', 'recebido'])
  if (opts.partnerId) q = q.eq('partner_id', opts.partnerId)
  if (opts.from) q = q.gte('due_date', opts.from)
  if (opts.to) q = q.lte('due_date', opts.to)

  const { data, error } = await q
  if (error) throw new Error(`partnerSplitTotals failed: ${error.message}`)

  const acc = new Map<string, { charges: number; splitCents: number; grossCents: number }>()
  for (const r of (data ?? []) as unknown as Array<{
    partner_id: string
    split_amount_cents: number | null
    amount_cents: number
  }>) {
    const cur = acc.get(r.partner_id) ?? { charges: 0, splitCents: 0, grossCents: 0 }
    cur.charges += 1
    cur.splitCents += r.split_amount_cents ?? 0
    cur.grossCents += r.amount_cents
    acc.set(r.partner_id, cur)
  }
  return [...acc.entries()].map(([partnerId, v]) => ({ partnerId, ...v }))
}
