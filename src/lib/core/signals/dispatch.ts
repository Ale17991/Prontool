/**
 * Feature 053 — despacho das mensagens que o ciclo decidiu enviar.
 *
 * Separado de `evaluate-cycle.ts` por uma razão prática: avaliar é rápido e
 * determinístico, despachar é lento e depende de rede. Misturar os dois faria
 * uma clínica com problema de conexão atrasar a avaliação de todas as outras.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { enqueuePatientMessage, isQstashConfigured } from '@/lib/integrations/queue/qstash-client'
import { sendToPatient } from '@/lib/core/messaging/send-to-patient'
import type { ChannelPreference } from '@/lib/core/messaging/types'
import type { PendingMessage } from './evaluate-cycle'

/** Segundos entre um envio e o seguinte, POR CLÍNICA. */
const SPACING_SECONDS = 4

/** Sem QStash (dev), o envio é inline — e aí o lote precisa ser pequeno. */
const INLINE_MAX = 10
const INLINE_SPACING_MS = 800

export interface DispatchResult {
  enfileiradas: number
  enviadasInline: number
  falhas: number
}

export async function dispatchPending(
  supabase: SupabaseClient<Database>,
  pending: PendingMessage[],
): Promise<DispatchResult> {
  const out: DispatchResult = { enfileiradas: 0, enviadasInline: 0, falhas: 0 }
  if (pending.length === 0) return out

  if (isQstashConfigured()) {
    // O contador é POR CLÍNICA: duas clínicas não precisam esperar uma à
    // outra, porque quem arrisca bloqueio é cada número isoladamente.
    const porClinica = new Map<string, number>()
    for (const item of pending) {
      const idx = porClinica.get(item.tenantId) ?? 0
      porClinica.set(item.tenantId, idx + 1)

      const enq = await enqueuePatientMessage({
        payload: {
          tenantId: item.tenantId,
          occurrenceId: item.occurrenceId,
          patientId: item.patientId,
          channel: item.channel,
          body: item.body,
        },
        delaySeconds: idx * SPACING_SECONDS,
        traceId: `signals-${item.tenantId}`,
      })
      if (enq.messageId) out.enfileiradas += 1
      else out.falhas += 1
    }
    return out
  }

  // Degradação em dev: exercita o fluxo sem estourar o timeout.
  const inline = pending.slice(0, INLINE_MAX)
  if (pending.length > inline.length) {
    logger.warn(
      { total: pending.length, enviadas: inline.length },
      'signals-inline-batch-truncated',
    )
  }
  for (const item of inline) {
    const res = await sendToPatient(supabase, {
      tenantId: item.tenantId,
      patientId: item.patientId,
      purpose: 'acompanhamento',
      body: item.body,
      preference: item.channel as ChannelPreference,
      occurrenceId: item.occurrenceId,
    })
    if (res.ok) out.enviadasInline += 1
    else out.falhas += 1
    await new Promise((r) => setTimeout(r, INLINE_SPACING_MS))
  }
  return out
}
