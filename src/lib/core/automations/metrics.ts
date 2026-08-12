/**
 * Feature 056 — os números de cada automação (FR-020).
 *
 * NADA aqui é contador gravado. Enviados, entregues e lidos são recompostos das
 * ocorrências e dos eventos de entrega a cada leitura — mesmo princípio do
 * SC-004 da 051 e da classificação de exame da 050: corrigir a regra reapura o
 * histórico inteiro, sem reescrever registro nenhum. Um contador incrementado
 * no envio ficaria errado para sempre no primeiro ciclo que morresse no meio.
 *
 * "Entregue" e "lido" vêm de `whatsapp_delivery_events` e resolvem por
 * PRECEDÊNCIA DE RANK (sent < delivered < read < error), nunca pelo evento mais
 * recente: as confirmações chegam fora de ordem, e um `delivered` atrasado que
 * chega depois de um `read` não pode rebaixar o que a clínica vê.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DELIVERY_RANK, type WhatsAppDeliveryStatus } from '@/lib/core/whatsapp/types'

const PAGINA = 1000
const BLOCO_IDS = 200

export interface AutomationMetrics {
  /** Ocorrências com desfecho `enviado` no período. */
  enviados: number
  /** Destas, as que o serviço confirmou como entregues (ou lidas). */
  entregues: number
  /** Destas, as lidas. */
  lidos: number
  /**
   * Suprimidas por teto que AINDA ESTÃO no banco — e isso é um piso, não um
   * total.
   *
   * A supressão é transitória de propósito: o motor grava a linha e a APAGA em
   * seguida, para o ciclo seguinte reavaliar o paciente que ficou de fora. Uma
   * linha que sobreviveu até aqui é, quase sempre, uma exclusão que falhou.
   *
   * Por isso a tela só mostra este número quando ele é maior que zero: exibir
   * "0 seguradas" afirmaria que o teto não segurou nada, quando o que houve foi
   * o teto funcionando exatamente como devia. Quantos ficaram para o próximo
   * ciclo é informação do CICLO (`EvaluateResult.suprimidas`, no log e na
   * resposta do cron), não do histórico.
   */
  suprimidos: number
  /** Impedidas por consentimento, telefone, variável ausente ou conexão. */
  impedidos: number
  falhas: number
}

export function metricsVazio(): AutomationMetrics {
  return { enviados: 0, entregues: 0, lidos: 0, suprimidos: 0, impedidos: 0, falhas: 0 }
}

/**
 * Os números de todas as automações da clínica num período, em duas consultas
 * mais os blocos de eventos — nunca uma consulta por automação.
 */
export async function getAutomationMetrics(
  supabase: SupabaseClient,
  tenantId: string,
  desdeIso: string,
): Promise<Map<string, AutomationMetrics>> {
  const porAutomacao = new Map<string, AutomationMetrics>()

  const ocorrencias: Array<{ id: string; automation_id: string; outcome: string }> = []
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await supabase
      .from('automation_occurrences')
      .select('id, automation_id, outcome')
      .eq('tenant_id', tenantId)
      .gte('created_at', desdeIso)
      .order('id')
      .range(offset, offset + PAGINA - 1)
    if (error) throw new Error(`getAutomationMetrics falhou: ${error.message}`)
    const pagina = (data ?? []) as Array<{ id: string; automation_id: string; outcome: string }>
    ocorrencias.push(...pagina)
    if (pagina.length < PAGINA) break
    // Uma clínica com 100 mil ocorrências em 30 dias não existe hoje; o teto
    // evita que um defeito de filtro vire varredura infinita.
    if (offset >= PAGINA * 99) break
  }

  const enviadas: string[] = []
  for (const o of ocorrencias) {
    const m = porAutomacao.get(o.automation_id) ?? metricsVazio()
    if (o.outcome === 'enviado') {
      m.enviados++
      enviadas.push(o.id)
    } else if (o.outcome.startsWith('suprimido_')) {
      m.suprimidos++
    } else if (o.outcome.startsWith('impedido_')) {
      m.impedidos++
    } else if (o.outcome === 'falhou') {
      m.falhas++
    }
    porAutomacao.set(o.automation_id, m)
  }

  if (enviadas.length === 0) return porAutomacao

  // O status corrente de cada ocorrência enviada.
  const status = new Map<string, WhatsAppDeliveryStatus>()
  for (let i = 0; i < enviadas.length; i += BLOCO_IDS) {
    const { data, error } = await supabase
      .from('whatsapp_delivery_events')
      .select('automation_occurrence_id, status')
      .eq('tenant_id', tenantId)
      .in('automation_occurrence_id', enviadas.slice(i, i + BLOCO_IDS))
    if (error) throw new Error(`getAutomationMetrics (eventos) falhou: ${error.message}`)

    for (const ev of (data ?? []) as Array<{
      automation_occurrence_id: string | null
      status: string
    }>) {
      if (!ev.automation_occurrence_id) continue
      const candidato = ev.status as WhatsAppDeliveryStatus
      const atual = status.get(ev.automation_occurrence_id)
      if (!atual || DELIVERY_RANK[candidato] > DELIVERY_RANK[atual]) {
        status.set(ev.automation_occurrence_id, candidato)
      }
    }
  }

  const automacaoDe = new Map(ocorrencias.map((o) => [o.id, o.automation_id]))
  for (const [occId, st] of status) {
    const autoId = automacaoDe.get(occId)
    if (!autoId) continue
    const m = porAutomacao.get(autoId)
    if (!m) continue
    // `read` implica entrega: o serviço nem sempre emite os dois ACKs, e exigir
    // um `delivered` explícito jogaria fora leitura confirmada. Mesma regra do
    // SC-004 da 051.
    if (st === 'delivered' || st === 'read') m.entregues++
    if (st === 'read') m.lidos++
  }

  return porAutomacao
}
