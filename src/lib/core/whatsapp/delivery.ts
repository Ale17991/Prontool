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
  /** Lembrete de consulta (051) — exclusivo com `automationOccurrenceId`. */
  reminderId?: string
  /**
   * Ocorrência de automação (056). A confirmação vem pela MESMA rota e do mesmo
   * serviço; o que muda é a que a mensagem se referia. O CHECK da 0197 recusa
   * linha com as duas ou com nenhuma.
   */
  automationOccurrenceId?: string
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
  if (Boolean(input.reminderId) === Boolean(input.automationOccurrenceId)) {
    // Recusa antes do banco para o erro apontar para o chamador, e não para o
    // nome de uma constraint. O CHECK da 0197 é a rede, não o guarda.
    throw new Error('recordDeliveryEvent: informe reminderId OU automationOccurrenceId')
  }

  const { error } = await supabase.from('whatsapp_delivery_events').insert({
    tenant_id: input.tenantId,
    reminder_id: input.reminderId ?? null,
    automation_occurrence_id: input.automationOccurrenceId ?? null,
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
    .not('reminder_id', 'is', null)
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
 * O mesmo, para ocorrências de automação (056).
 *
 * Existe como função separada em vez de um parâmetro "qual coluna" porque a
 * chamada fica legível no ponto de uso — e porque as duas origens NUNCA devem
 * ser misturadas numa consulta só: taxa de leitura de lembrete e de automação
 * são medidas diferentes, e somá-las por descuido produziria um número que não
 * descreve nem uma nem outra.
 */
export async function resolveAutomationDeliveryStatuses(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  occurrenceIds: string[],
): Promise<Map<string, WhatsAppDeliveryStatus>> {
  const out = new Map<string, WhatsAppDeliveryStatus>()
  if (occurrenceIds.length === 0) return out

  // Em blocos: um `IN` com milhares de uuids estoura o tamanho da URL do
  // PostgREST, e o erro chega como 414 — que ninguém associa a "a clínica
  // cresceu".
  const BLOCO = 200
  for (let i = 0; i < occurrenceIds.length; i += BLOCO) {
    const { data, error } = await supabase
      .from('whatsapp_delivery_events')
      .select('automation_occurrence_id, status')
      .eq('tenant_id', tenantId)
      .in('automation_occurrence_id', occurrenceIds.slice(i, i + BLOCO))
    if (error) throw new Error(`resolveAutomationDeliveryStatuses failed: ${error.message}`)

    for (const row of (data ?? []) as Array<{
      automation_occurrence_id: string | null
      status: string
    }>) {
      if (!row.automation_occurrence_id) continue
      const candidato = row.status as WhatsAppDeliveryStatus
      const atual = out.get(row.automation_occurrence_id)
      if (!atual || pickHighest(atual, candidato) === candidato) {
        out.set(row.automation_occurrence_id, candidato)
      }
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
