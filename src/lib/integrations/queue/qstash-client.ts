import { Client } from '@upstash/qstash'
import { logger } from '@/lib/observability/logger'

let qstashSingleton: Client | null = null

export function isQstashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN) && Boolean(process.env.NEXT_PUBLIC_APP_URL)
}

function getQstash(token: string): Client {
  if (qstashSingleton) return qstashSingleton
  qstashSingleton = new Client({ token })
  return qstashSingleton
}

/**
 * Enqueues a raw webhook event for semantic processing. QStash retries
 * with exponential backoff on 5xx from the callback; after the configured
 * retry budget the message lands in QStash's DLQ and ours.
 *
 * When QStash is not configured (missing QSTASH_TOKEN or NEXT_PUBLIC_APP_URL),
 * returns `{ messageId: null }` and logs a warning. Callers that need
 * guaranteed delivery should gate on `isQstashConfigured()` and 503 upfront;
 * best-effort callers can ignore the null result.
 */
/**
 * Feature 051 — publica UM envio de lembrete por WhatsApp, com atraso.
 *
 * O `delaySeconds` crescente é o que espaça o lote (FR-013). Disparar em
 * rajada aumenta o risco de bloqueio do número da clínica, e é a única
 * mitigação real que existe usando uma solução não-oficial.
 *
 * Não usamos cron mais frequente para isso: no plano Hobby da Vercel, cron
 * acima de diário trava TODOS os deploys, em silêncio.
 */
export async function enqueueWhatsAppReminder(args: {
  payload: Record<string, unknown>
  delaySeconds: number
  traceId: string
}): Promise<{ messageId: string | null }> {
  const token = process.env.QSTASH_TOKEN
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!token || !appUrl) {
    logger.warn(
      { has_token: Boolean(token), has_app_url: Boolean(appUrl) },
      'qstash-not-configured-skipping-whatsapp-enqueue',
    )
    return { messageId: null }
  }

  const callback = new URL('/api/workers/send-whatsapp-reminder', appUrl).toString()

  try {
    const res = await getQstash(token).publishJSON({
      url: callback,
      body: args.payload,
      delay: Math.max(0, Math.round(args.delaySeconds)),
      // Menos que o GHL: uma mensagem de lembrete tem validade curta. Insistir
      // por muito tempo entregaria um "sua consulta é amanhã" depois da consulta.
      retries: 2,
      headers: { 'X-Trace-Id': args.traceId },
    })
    return { messageId: res.messageId }
  } catch (err) {
    logger.error({ err }, 'qstash-whatsapp-publish-failed')
    return { messageId: null }
  }
}

/**
 * Feature 053 — publica UMA mensagem de acompanhamento, com atraso.
 *
 * Mesmo raciocínio do lembrete: espaçar por clínica é a mitigação real contra
 * bloqueio do número. A diferença está no `retries`: aqui vale insistir mais.
 * Um lembrete de consulta vence — entregar "sua consulta é amanhã" depois da
 * consulta é pior que não entregar. Uma mensagem de acompanhamento continua
 * fazendo sentido algumas horas depois.
 */
export async function enqueuePatientMessage(args: {
  payload: Record<string, unknown>
  delaySeconds: number
  traceId: string
}): Promise<{ messageId: string | null }> {
  const token = process.env.QSTASH_TOKEN
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!token || !appUrl) {
    logger.warn(
      { has_token: Boolean(token), has_app_url: Boolean(appUrl) },
      'qstash-not-configured-skipping-patient-message-enqueue',
    )
    return { messageId: null }
  }

  const callback = new URL('/api/workers/send-patient-message', appUrl).toString()

  try {
    const res = await getQstash(token).publishJSON({
      url: callback,
      body: args.payload,
      delay: Math.max(0, Math.round(args.delaySeconds)),
      retries: 3,
      headers: { 'X-Trace-Id': args.traceId },
    })
    return { messageId: res.messageId }
  } catch (err) {
    logger.error({ err }, 'qstash-patient-message-publish-failed')
    return { messageId: null }
  }
}

export async function enqueueGhlEvent(args: {
  rawEventId: string
  tenantId: string
  traceId: string
}): Promise<{ messageId: string | null }> {
  const token = process.env.QSTASH_TOKEN
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!token || !appUrl) {
    logger.warn(
      { ...args, has_token: Boolean(token), has_app_url: Boolean(appUrl) },
      'qstash-not-configured-skipping-enqueue',
    )
    return { messageId: null }
  }

  const callback = new URL('/api/workers/process-ghl-event', appUrl).toString()

  try {
    const res = await getQstash(token).publishJSON({
      url: callback,
      body: { rawEventId: args.rawEventId, tenantId: args.tenantId },
      retries: 5,
      headers: { 'X-Trace-Id': args.traceId },
    })
    return { messageId: res.messageId }
  } catch (err) {
    logger.error({ err, ...args }, 'qstash-publish-failed')
    throw err
  }
}
