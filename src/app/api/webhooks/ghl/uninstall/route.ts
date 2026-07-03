import { logger } from '@/lib/observability/logger'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  readMarketplaceSignatureHeaders,
  verifyMarketplaceSignature,
  InvalidMarketplaceSignatureError,
} from '@/lib/integrations/ghl/oauth/verify-marketplace-signature'
import { marketplaceUninstallSchema } from '@/lib/integrations/ghl/oauth/types'
import { disconnectGhlTenant } from '@/lib/core/integrations/ghl/disconnect-tenant'

/**
 * Feature 008 — POST /api/webhooks/ghl/uninstall
 *
 * Webhook do GHL Marketplace quando uma sub-account desinstala o app.
 * Marca tenant_integrations como `enabled=false, status='disconnected'`.
 * NÃO apaga pacientes/atendimentos/etc.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const processedUninstalls = new Map<string, number>()
const DEDUP_WINDOW_MS = 60 * 60 * 1000

function checkInProcessIdempotency(eventId: string): boolean {
  const now = Date.now()
  for (const [k, t] of processedUninstalls) {
    if (now - t > DEDUP_WINDOW_MS) processedUninstalls.delete(k)
  }
  if (processedUninstalls.has(eventId)) return true
  processedUninstalls.set(eventId, now)
  return false
}

export async function POST(req: Request): Promise<Response> {
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Body não é legível')
  }

  const sigHeaders = readMarketplaceSignatureHeaders(req.headers)
  try {
    verifyMarketplaceSignature({
      rawBody,
      signature: sigHeaders.signature,
      timestamp: sigHeaders.timestamp,
    })
  } catch (err) {
    if (err instanceof InvalidMarketplaceSignatureError) {
      logger.warn({ reason: err.reason }, 'ghl-marketplace-uninstall-signature-invalid')
      return jsonError(401, 'INVALID_SIGNATURE', 'Assinatura inválida')
    }
    throw err
  }

  let parsed
  try {
    parsed = marketplaceUninstallSchema.parse(JSON.parse(rawBody))
  } catch (err) {
    return jsonError(400, 'INVALID_BODY', 'Payload UNINSTALL inválido', {
      issues: err instanceof Error ? err.message.slice(0, 300) : null,
    })
  }

  if (checkInProcessIdempotency(parsed.eventId)) {
    return jsonOk({ received: true, duplicate: true })
  }

  const supabase = createSupabaseServiceClient()
  const { data: row } = await supabase
    .from('tenant_integrations')
    .select('tenant_id')
    .eq('provider', 'ghl')
    .eq('location_id', parsed.locationId)
    .maybeSingle()

  if (!row?.tenant_id) {
    // Sub-account nunca mapeada — idempotente, retorna 200.
    return jsonOk({ received: true, no_match: true })
  }

  try {
    const result = await disconnectGhlTenant({
      supabase,
      source: 'marketplace_uninstall',
      actorUserId: null,
      actorLabel: 'system:ghl_marketplace_uninstall',
      tenantId: row.tenant_id,
      reason: parsed.reason,
    })
    return jsonOk({
      received: true,
      duplicate: false,
      tenant_id: row.tenant_id,
      cleanup_remaining_count: result.cleanupRemaining.length,
    })
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), event_id: parsed.eventId },
      'ghl-marketplace-uninstall-failed',
    )
    return jsonError(500, 'UNINSTALL_FAILED', 'Falha ao processar uninstall.')
  }
}

function jsonOk(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function jsonError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, message, ...extra } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
