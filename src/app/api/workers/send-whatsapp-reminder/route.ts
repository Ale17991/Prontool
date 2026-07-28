import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  verifyQstashSignature,
  isQstashSigningConfigured,
} from '@/lib/integrations/queue/verify-qstash-signature'
import { InvalidSignatureError } from '@/lib/observability/errors'
import { traceIdFromHeaders } from '@/lib/observability/trace'
import { logger } from '@/lib/observability/logger'
import { getDecryptedApiKey } from '@/lib/core/whatsapp/config'
import { sendOneWhatsAppReminder } from '@/lib/core/reminders/send-one-whatsapp'
import type { EligibleAppointment, TenantReminderSettings } from '@/lib/core/reminders/types'

/**
 * Feature 051 — envia UM lembrete de WhatsApp, chamado pelo QStash.
 *
 * Existe para atender o FR-013 (espaçar os envios) sem esbarrar em duas
 * restrições que se cruzam: o ciclo do cron dispararia até 200 mensagens de uma
 * vez, e 200 × 4s de espaçamento estoura o timeout da função da Vercel; e cron
 * mais frequente que diário trava TODOS os deploys no plano Hobby.
 *
 * O QStash resolve os dois: cada envio é publicado com `delay` crescente e
 * chega aqui no seu instante, um por requisição.
 *
 * A rota é pública por natureza (o QStash chama de fora) e autenticada pela
 * assinatura dele — o prefixo `workers/` é isento de requireRole em
 * `check-require-role.mjs` pelo mesmo motivo.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodyShape = z.object({
  tenantId: z.string().uuid(),
  eligible: z.object({}).passthrough(),
  settings: z.object({}).passthrough(),
  offsetHours: z.number(),
  clinicName: z.string(),
  clinicPhone: z.string().nullable(),
  publicBookingUrl: z.string().nullable(),
  templateWhatsApp: z.string().nullable(),
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
    logger.error({ trace_id: traceId }, 'whatsapp-worker-invalid-body')
    return NextResponse.json({ ok: false, reason: 'invalid-body' })
  }

  const input = parsed.data
  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient

  const apiKey = await getDecryptedApiKey(supabase, input.tenantId)
  if (!apiKey) {
    // A clínica desconectou entre o enfileiramento e a entrega. Não é erro
    // transitório: re-tentar não vai fazer a credencial reaparecer.
    logger.warn({ trace_id: traceId, tenantId: input.tenantId }, 'whatsapp-worker-no-credentials')
    return NextResponse.json({ ok: false, reason: 'no-credentials' })
  }

  try {
    const result = await sendOneWhatsAppReminder({
      supabase,
      eligible: input.eligible as unknown as EligibleAppointment,
      settings: input.settings as unknown as TenantReminderSettings,
      offsetHours: input.offsetHours,
      isManual: false,
      clinicName: input.clinicName,
      clinicPhone: input.clinicPhone,
      publicBookingUrl: input.publicBookingUrl,
      templateWhatsApp: input.templateWhatsApp,
      apiKey,
    })
    return NextResponse.json({ ok: true, status: result.record?.status ?? 'skipped' })
  } catch (err) {
    // Falha inesperada: 5xx faz o QStash re-tentar com backoff. É seguro — o
    // `externalId` deduplica no serviço de envio, então a retentativa não
    // manda a mensagem duas vezes.
    logger.error({ trace_id: traceId, err }, 'whatsapp-worker-failed')
    return NextResponse.json({ error: { code: 'SEND_FAILED' } }, { status: 500 })
  }
}
