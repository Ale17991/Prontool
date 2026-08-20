import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { getDecryptedCallbackSecret } from '@/lib/core/whatsapp/config'
import { recordDeliveryEvent } from '@/lib/core/whatsapp/delivery'
import type { WhatsAppDeliveryStatus } from '@/lib/core/whatsapp/types'

/**
 * Feature 051 — US4 — confirmação de entrega vinda do serviço de WhatsApp.
 *
 * Rota pública por natureza (quem chama é o serviço, de fora), autenticada por
 * segredo compartilhado POR CLÍNICA. O prefixo `webhooks/` já é isento de
 * requireRole em `check-require-role.mjs` — a autenticação aqui é o Bearer, não
 * a sessão.
 *
 * Contrato em `specs/051-whatsapp-evolution/contracts/status-callback.md`.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUS_VALIDOS: readonly string[] = ['sent', 'delivered', 'read', 'error']

/** Comparação em tempo constante. `===` vaza o prefixo acertado pelo tempo. */
function segredosBatem(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const externalId = typeof body.externalId === 'string' ? body.externalId : ''
  const status = typeof body.status === 'string' ? body.status : ''
  if (!externalId || !STATUS_VALIDOS.includes(status)) {
    // Payload que não reconhecemos não melhora com retry.
    return NextResponse.json({ ok: true, ignored: 'unknown-payload' })
  }

  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient<Database>

  /**
   * O `externalId` é o id do LEMBRETE (051, D6) ou o da OCORRÊNCIA de automação
   * (056) — os dois motores usam o mesmo campo como chave de idempotência, e
   * ambos são uuid.
   *
   * A busca é em cascata, lembrete primeiro, porque não há como distinguir os
   * dois pelo formato e o lembrete é o caminho mais antigo e mais movimentado.
   * Antes da 0197 a segunda tentativa não existia e TODA confirmação de
   * automação morria aqui como `unknown-reminder` — 200, sem erro, sem rastro.
   *
   * O tenant vem DAQUI em qualquer um dos casos, nunca do corpo da requisição:
   * quem manda o payload não decide em qual clínica escreve (Princípio III).
   */
  const { data: reminder } = await supabase
    .from('appointment_reminders')
    .select('id, tenant_id, channel')
    .eq('id', externalId)
    .maybeSingle()

  let origem: { tenantId: string; reminderId?: string; automationOccurrenceId?: string } | null =
    reminder
      ? {
          tenantId: (reminder as { tenant_id: string }).tenant_id,
          reminderId: (reminder as { id: string }).id,
        }
      : null

  if (!origem) {
    const { data: ocorrencia } = await supabase
      .from('automation_occurrences')
      .select('id, tenant_id')
      .eq('id', externalId)
      .maybeSingle()
    if (ocorrencia) {
      const o = ocorrencia as { id: string; tenant_id: string }
      origem = { tenantId: o.tenant_id, automationOccurrenceId: o.id }
    }
  }

  if (!origem) {
    // Confirmação de algo que não é nosso, ou de outro ambiente apontando para
    // cá. 200 de propósito: 4xx faria o serviço re-tentar em loop.
    return NextResponse.json({ ok: true, ignored: 'unknown-external-id' })
  }

  // Autenticação DEPOIS de resolver o tenant, porque o segredo é por clínica.
  const esperado = await getDecryptedCallbackSecret(supabase, origem.tenantId).catch(() => null)
  const apresentado = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!esperado || !apresentado || !segredosBatem(apresentado, esperado)) {
    logger.warn({ tenantId: origem.tenantId }, 'whatsapp-callback-unauthorized')
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    await recordDeliveryEvent(supabase, {
      tenantId: origem.tenantId,
      reminderId: origem.reminderId,
      automationOccurrenceId: origem.automationOccurrenceId,
      providerMessageId: typeof body.messageId === 'string' ? body.messageId : null,
      status: status as WhatsAppDeliveryStatus,
      errorDetail: typeof body.error === 'string' ? body.error : null,
      // `timestamp` é quando o evento ocorreu segundo o serviço; a coluna
      // `received_at` guarda quando chegou aqui. Divergência grande entre as
      // duas denuncia atraso na ponte.
      occurredAt: typeof body.timestamp === 'string' ? body.timestamp : new Date().toISOString(),
    })
  } catch (err) {
    logger.error({ tenantId: origem.tenantId, err }, 'whatsapp-callback-record-failed')
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }

  // LGPD: o payload traz `to` (telefone do paciente). Ele NÃO é persistido nem
  // logado — chega, é ignorado e morre aqui.
  return NextResponse.json({ ok: true })
}
