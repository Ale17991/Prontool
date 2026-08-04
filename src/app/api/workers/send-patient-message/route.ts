import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  verifyQstashSignature,
  isQstashSigningConfigured,
} from '@/lib/integrations/queue/verify-qstash-signature'
import { InvalidSignatureError } from '@/lib/observability/errors'
import { traceIdFromHeaders } from '@/lib/observability/trace'
import { logger } from '@/lib/observability/logger'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { sendToPatient } from '@/lib/core/messaging/send-to-patient'
import type { ChannelPreference } from '@/lib/core/messaging/types'

/**
 * Feature 053 — entrega UMA mensagem de acompanhamento, chamada pelo QStash.
 *
 * A rota é pública por natureza (o QStash chama de fora) e autenticada pela
 * assinatura dele — o prefixo `workers/` é isento de `requireRole` em
 * `check-require-role.mjs` pelo mesmo motivo do worker de lembretes.
 *
 * ---
 *
 * REVALIDA TUDO ANTES DE ENVIAR. Entre a decisão do ciclo e a chegada aqui
 * passam segundos ou minutos, e nesse intervalo a clínica pode ter desligado a
 * regra, perdido o módulo, ou o paciente pode ter revogado o consentimento. A
 * decisão de ontem não autoriza o envio de hoje — e a mensagem, depois de
 * entregue, não volta.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodyShape = z.object({
  tenantId: z.string().uuid(),
  occurrenceId: z.string().uuid(),
  patientId: z.string().uuid(),
  channel: z.enum(['whatsapp', 'email', 'preferencial']),
  body: z.string().min(1),
})

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text()
  const traceId = traceIdFromHeaders(req.headers)

  if (process.env.NODE_ENV !== 'test') {
    if (!isQstashSigningConfigured()) {
      logger.warn({ trace_id: traceId }, 'qstash-signing-not-configured')
      return NextResponse.json(
        { error: { code: 'QSTASH_NOT_CONFIGURED', message: 'Worker disabled' } },
        { status: 503 },
      )
    }
    try {
      await verifyQstashSignature({
        signature: req.headers.get('upstash-signature'),
        body: rawBody,
        url: req.url,
      })
    } catch (err) {
      if (err instanceof InvalidSignatureError) {
        return NextResponse.json(
          { error: { code: 'INVALID_SIGNATURE', message: 'QStash signature invalid' } },
          { status: 401 },
        )
      }
      throw err
    }
  }

  const parsed = bodyShape.safeParse(JSON.parse(rawBody || '{}'))
  if (!parsed.success) {
    // Corpo inválido não melhora com retry — 200 para o QStash parar.
    logger.error({ trace_id: traceId }, 'signals-worker-invalid-body')
    return NextResponse.json({ ok: false, reason: 'invalid-body' })
  }

  const input = parsed.data
  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient<Database>

  // 1. Módulo ainda ligado? Revogar no /admin precisa surtir efeito imediato,
  //    inclusive no que já estava na fila.
  const ent = await getTenantEntitlements(supabase, input.tenantId).catch(() => null)
  if (ent && !ent.hasModule('acompanhamento')) {
    logger.info({ trace_id: traceId, tenantId: input.tenantId }, 'signals-worker-module-off')
    return NextResponse.json({ ok: false, reason: 'module-off' })
  }

  // 2. A regra que originou isto ainda está ativa? A clínica pode ter desligado
  //    depois do enfileiramento, e "desligar" só significa algo se alcançar o
  //    que ainda não saiu.
  const oc = await supabase
    .from('signal_occurrences')
    .select('rule_id, signal_rules!inner(active)')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.occurrenceId)
    .maybeSingle()
  const regraAtiva = (oc.data as { signal_rules?: { active?: boolean } } | null)?.signal_rules
    ?.active
  if (oc.data && regraAtiva === false) {
    logger.info({ trace_id: traceId, tenantId: input.tenantId }, 'signals-worker-rule-inactive')
    return NextResponse.json({ ok: false, reason: 'rule-inactive' })
  }

  // 3. Consentimento, contato e canal são revalidados dentro do `sendToPatient`
  //    — é ele que sabe a regra, e duplicá-la aqui criaria dois lugares para
  //    divergir.
  const res = await sendToPatient(supabase, {
    tenantId: input.tenantId,
    patientId: input.patientId,
    purpose: 'acompanhamento',
    body: input.body,
    preference: input.channel as ChannelPreference,
    occurrenceId: input.occurrenceId,
  })

  if (!res.ok) {
    logger.warn(
      { trace_id: traceId, tenantId: input.tenantId, reason: res.reason },
      'signals-worker-not-sent',
    )
    // 200 mesmo assim: recusa de consentimento e falta de contato não melhoram
    // com retry, e devolver 5xx faria o QStash insistir num caso resolvido.
    return NextResponse.json({ ok: false, reason: res.reason })
  }

  return NextResponse.json({ ok: true, messageId: res.messageId, channel: res.channel })
}
