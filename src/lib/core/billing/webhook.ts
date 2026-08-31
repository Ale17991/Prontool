/**
 * Processamento dos eventos de cobrança do Asaas.
 *
 * O Asaas REENTREGA o evento até receber 200. Isso torna a idempotência não
 * negociável: sem ela, uma reentrega de `PAYMENT_RECEIVED` reativaria uma
 * clínica que foi cancelada depois. A chave é o `id` do evento
 * (`billing_webhook_events.asaas_event_id`, UNIQUE) — não o id da cobrança,
 * que aparece em vários eventos legítimos.
 *
 * O evento é GRAVADO ANTES de ser processado, e só depois carimbado. Gravar
 * depois abriria janela para perder o evento se o processo morresse no meio —
 * mesma doutrina de `automation_occurrences` (056).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import type { AsaasPayment, ChargeStatus } from './asaas/types'
import { upsertChargeFromAsaas } from './charges'
import { entitlementStatusFor } from './status'

/** Eventos que mexem no espelho de cobrança. Os demais são registrados e ignorados. */
const PAYMENT_EVENTS = new Set([
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_RESTORED',
  'PAYMENT_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
])

export interface AsaasWebhookBody {
  id?: string
  event?: string
  payment?: AsaasPayment
}

export interface WebhookOutcome {
  /** `true` = já tínhamos processado; nada foi refeito. */
  duplicate: boolean
  /** `null` quando não deu para resolver a clínica. */
  tenantId: string | null
  status: ChargeStatus | null
  ignored?: string
}

/**
 * Registra o evento cru. Devolve `duplicate: true` quando o `asaas_event_id` já
 * existe — o UNIQUE do banco é o árbitro, não uma consulta prévia: entre o
 * SELECT e o INSERT cabe uma reentrega concorrente.
 */
async function recordEvent(
  supabase: SupabaseClient<Database>,
  body: AsaasWebhookBody,
): Promise<{ duplicate: boolean; eventRowId: string | null }> {
  const { data, error } = await supabase
    .from('billing_webhook_events' as never)
    .insert({
      asaas_event_id: body.id,
      event: body.event,
      payment_id: body.payment?.id ?? null,
      payload: body as unknown,
    } as never)
    .select('id')
    .single()

  if (error) {
    // 23505 = unique_violation ⇒ reentrega de evento já recebido.
    if ((error as { code?: string }).code === '23505') {
      return { duplicate: true, eventRowId: null }
    }
    throw new Error(`recordEvent failed: ${error.message}`)
  }
  return { duplicate: false, eventRowId: (data as unknown as { id: string }).id }
}

/**
 * De qual clínica é esta cobrança?
 *
 * Ordem: `externalReference` (que nós mesmos gravamos na emissão) → cobrança já
 * espelhada → assinatura conhecida. O tenant NUNCA vem de um campo livre do
 * payload sem cruzamento: quem manda a requisição não decide em qual clínica
 * escrevemos (Princípio III), e por isso o `externalReference` só é aceito
 * depois de conferido contra `tenants`.
 */
async function resolveTenant(
  supabase: SupabaseClient<Database>,
  payment: AsaasPayment,
): Promise<string | null> {
  const ref = payment.externalReference
  if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
    const { data } = await supabase.from('tenants').select('id').eq('id', ref).maybeSingle()
    if (data) return (data as { id: string }).id
  }

  const { data: charge } = await supabase
    .from('billing_charges' as never)
    .select('tenant_id')
    .eq('asaas_payment_id', payment.id)
    .maybeSingle()
  if (charge) return (charge as unknown as { tenant_id: string }).tenant_id

  if (payment.subscription) {
    const { data: billing } = await supabase
      .from('tenant_billing' as never)
      .select('tenant_id')
      .eq('asaas_subscription_id', payment.subscription)
      .maybeSingle()
    if (billing) return (billing as unknown as { tenant_id: string }).tenant_id
  }
  return null
}

/**
 * Reflete a cobrança e ajusta o status da assinatura da clínica.
 *
 * O rebaixamento por vencimento NÃO derruba quem está em `trial` nem quem já
 * foi `canceled` por decisão comercial: o webhook conta um fato sobre uma
 * fatura, e o estado do contrato é decisão de quem opera o /admin.
 */
async function applyEntitlement(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  status: ChargeStatus,
): Promise<void> {
  const target = entitlementStatusFor(status)
  if (!target) return

  const { data } = await supabase
    .from('tenant_entitlements')
    .select('status')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const current = (data as { status?: string } | null)?.status ?? null

  if (current === target) return
  // Cancelamento é decisão comercial e não se desfaz por evento de gateway —
  // uma fatura antiga liquidando não pode ressuscitar contrato encerrado.
  if (current === 'canceled') return

  const { error } = await supabase
    .from('tenant_entitlements')
    .update({ status: target })
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`applyEntitlement failed: ${error.message}`)

  logger.info(
    {
      event: 'billing.entitlement_changed',
      tenant_id: tenantId,
      from: current,
      to: target,
      charge_status: status,
    },
    'billing-entitlement-changed',
  )
}

/** Ponto de entrada do webhook. Nunca lança para o chamador HTTP. */
export async function handleAsaasWebhook(
  supabase: SupabaseClient<Database>,
  body: AsaasWebhookBody,
): Promise<WebhookOutcome> {
  if (!body.id || !body.event) {
    return { duplicate: false, tenantId: null, status: null, ignored: 'payload-sem-id-ou-evento' }
  }

  const { duplicate, eventRowId } = await recordEvent(supabase, body)
  if (duplicate) return { duplicate: true, tenantId: null, status: null }

  if (!PAYMENT_EVENTS.has(body.event) || !body.payment) {
    await markProcessed(supabase, eventRowId, null, null)
    return { duplicate: false, tenantId: null, status: null, ignored: 'evento-nao-tratado' }
  }

  const payment = body.payment
  const tenantId = await resolveTenant(supabase, payment)
  if (!tenantId) {
    // 200 mesmo assim: reentregar não vai fazer a clínica aparecer, e insistir
    // só encheria a fila do Asaas. O evento fica gravado com o motivo, e a
    // reconciliação manual no /admin resolve quando a origem for identificada.
    await markProcessed(supabase, eventRowId, null, 'tenant-nao-resolvido')
    logger.warn(
      { event: 'billing.webhook_orphan', asaas_payment_id: payment.id },
      'asaas-webhook-tenant-unresolved',
    )
    return { duplicate: false, tenantId: null, status: null, ignored: 'tenant-nao-resolvido' }
  }

  try {
    const status = await upsertChargeFromAsaas(supabase, tenantId, payment)
    await applyEntitlement(supabase, tenantId, status)
    await markProcessed(supabase, eventRowId, tenantId, null)
    return { duplicate: false, tenantId, status }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await markProcessed(supabase, eventRowId, tenantId, msg)
    throw err
  }
}

async function markProcessed(
  supabase: SupabaseClient<Database>,
  eventRowId: string | null,
  tenantId: string | null,
  error: string | null,
): Promise<void> {
  if (!eventRowId) return
  await supabase
    .from('billing_webhook_events' as never)
    .update({
      processed_at: new Date().toISOString(),
      process_error: error,
      ...(tenantId ? { tenant_id: tenantId } : {}),
    } as never)
    .eq('id', eventRowId)
}
