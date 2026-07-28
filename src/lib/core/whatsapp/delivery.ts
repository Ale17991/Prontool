/**
 * Feature 051 — US4 — evolução de entrega das mensagens de WhatsApp.
 *
 * A tabela `whatsapp_delivery_events` é append-only e existe separada de
 * `appointment_reminders` por um motivo concreto: o trigger
 * `enforce_reminders_status_transition` (0094) só permite `queued → terminal`.
 * Um lembrete já em `sent` não aceita mais UPDATE de status, e relaxar isso
 * para acomodar 'delivered'/'read' enfraqueceria uma garantia de imutabilidade
 * que já existia antes desta feature.
 *
 * A consequência é que "o status atual" vira regra de LEITURA, não de escrita:
 * resolvemos por PRECEDÊNCIA DE RANK, nunca pelo evento mais recente. Uma
 * confirmação de `delivered` que chega atrasada, depois de um `read`, fica
 * registrada — porque de fato chegou — mas não rebaixa o que a clínica vê
 * (FR-019).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DELIVERY_RANK, type WhatsAppDeliveryStatus } from './types'

export interface RecordDeliveryEventInput {
  tenantId: string
  reminderId: string
  providerMessageId: string | null
  status: WhatsAppDeliveryStatus
  errorDetail?: string | null
  occurredAt: string
}

/**
 * Grava um evento. A MESMA confirmação chegando duas vezes gera duas linhas —
 * é proposital: a tabela é um log do que o serviço nos contou, e deduplicar na
 * escrita esconderia retentativa em loop, que é sinal operacional útil.
 */
export async function recordDeliveryEvent(
  supabase: SupabaseClient<Database>,
  input: RecordDeliveryEventInput,
): Promise<void> {
  const { error } = await supabase.from('whatsapp_delivery_events').insert({
    tenant_id: input.tenantId,
    reminder_id: input.reminderId,
    provider_message_id: input.providerMessageId,
    status: input.status,
    error_detail: input.errorDetail ? input.errorDetail.slice(0, 500) : null,
    occurred_at: input.occurredAt,
  })
  if (error) throw new Error(`recordDeliveryEvent failed: ${error.message}`)
}

/**
 * Status corrente de um conjunto de lembretes: o de MAIOR rank por lembrete.
 * Devolve um mapa reminderId → status para a tela montar a coluna sem N+1.
 */
export async function resolveDeliveryStatuses(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  reminderIds: string[],
): Promise<Map<string, WhatsAppDeliveryStatus>> {
  const out = new Map<string, WhatsAppDeliveryStatus>()
  if (reminderIds.length === 0) return out

  const { data, error } = await supabase
    .from('whatsapp_delivery_events')
    .select('reminder_id, status')
    .eq('tenant_id', tenantId)
    .in('reminder_id', reminderIds)
  if (error) throw new Error(`resolveDeliveryStatuses failed: ${error.message}`)

  for (const row of (data ?? []) as Array<{ reminder_id: string; status: string }>) {
    const candidato = row.status as WhatsAppDeliveryStatus
    const atual = out.get(row.reminder_id)
    if (!atual || pickHighest(atual, candidato) === candidato) {
      out.set(row.reminder_id, candidato)
    }
  }
  return out
}

/**
 * Compara dois status e devolve o que "vale". Exportado porque a regra é a
 * mesma em qualquer lugar que precise resolver precedência, e duplicá-la seria
 * o jeito mais fácil de os dois lados divergirem.
 */
export function pickHighest(
  a: WhatsAppDeliveryStatus,
  b: WhatsAppDeliveryStatus,
): WhatsAppDeliveryStatus {
  return DELIVERY_RANK[b] > DELIVERY_RANK[a] ? b : a
}
