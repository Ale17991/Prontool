/**
 * Feature 029 (US6/T053+T054) — conta a receber e conciliação por lote TISS.
 *
 * O lote exportado é a "conta a receber" da operadora (faturado = soma das
 * guias). Os recebimentos (inclusive parciais por glosa) são lançados em
 * `tiss_lote_payments` (append-only). Quando o recebido alcança o faturado, as
 * guias `exportada` do lote passam a `paga`.
 *
 * DECISÃO (usuário): o repasse médico permanece sobre o valor FATURADO — esta
 * conciliação NÃO altera comissão/repasse; é puramente entrada de caixa.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'
import { recordTissAudit } from './audit'

type Client = SupabaseClient<Database>

export interface RecordLotePaymentArgs {
  supabase: Client
  tenantId: string
  loteId: string
  amountCents: number
  note?: string | null
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export interface RecordLotePaymentResult {
  paymentId: string
  billedCents: number
  receivedCents: number
  pendingCents: number
  fullyPaid: boolean
}

/** Soma faturada do lote = soma do valor congelado das guias vinculadas. */
async function billedForLote(supabase: Client, tenantId: string, loteId: string): Promise<number> {
  const { data, error } = await supabase
    .from('tiss_guias')
    .select('frozen_amount_cents')
    .eq('tenant_id', tenantId)
    .eq('lote_id', loteId)
  if (error) throw new Error(`billedForLote: ${error.message}`)
  return (data ?? []).reduce((s, g) => s + Number(g.frozen_amount_cents ?? 0), 0)
}

export async function recordLotePayment(
  args: RecordLotePaymentArgs,
): Promise<RecordLotePaymentResult> {
  const { supabase, tenantId, loteId } = args
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new ValidationError('Valor recebido inválido.')
  }

  const { data: lote, error: loteErr } = await supabase
    .from('tiss_lotes')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('id', loteId)
    .maybeSingle()
  if (loteErr) throw new Error(`recordLotePayment read lote: ${loteErr.message}`)
  if (!lote) throw new NotFoundError('tiss_lote', loteId)

  const { data: payRow, error: payErr } = await supabase
    .from('tiss_lote_payments')
    .insert({
      tenant_id: tenantId,
      lote_id: loteId,
      amount_cents: args.amountCents,
      note: args.note ?? null,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (payErr) throw new Error(`recordLotePayment insert: ${payErr.message}`)

  const billed = await billedForLote(supabase, tenantId, loteId)
  const { data: pays } = await supabase
    .from('tiss_lote_payments')
    .select('amount_cents')
    .eq('tenant_id', tenantId)
    .eq('lote_id', loteId)
  const received = (pays ?? []).reduce((s, p) => s + Number(p.amount_cents ?? 0), 0)
  const fullyPaid = billed > 0 && received >= billed

  // Recebimento total → guias ainda 'exportada' passam a 'paga' (glosadas/
  // parciais mantêm seu status).
  if (fullyPaid) {
    const { error: updErr } = await supabase
      .from('tiss_guias')
      .update({ status: 'paga' })
      .eq('tenant_id', tenantId)
      .eq('lote_id', loteId)
      .eq('status', 'exportada')
    if (updErr) throw new Error(`recordLotePayment mark paga: ${updErr.message}`)
  }

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'tiss_lote_payments',
    entityId: payRow.id,
    field: 'tiss.lote.payment',
    detail: { lote_id: loteId, amount_cents: args.amountCents, received, billed, fully_paid: fullyPaid },
    reason: 'registro de recebimento do convênio',
    ip: args.ip,
    userAgent: args.userAgent,
  })

  return {
    paymentId: payRow.id,
    billedCents: billed,
    receivedCents: received,
    pendingCents: Math.max(0, billed - received),
    fullyPaid,
  }
}
