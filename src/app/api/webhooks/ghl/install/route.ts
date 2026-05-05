import { randomUUID } from 'node:crypto'
import { logger } from '@/lib/observability/logger'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  readMarketplaceSignatureHeaders,
  verifyMarketplaceSignature,
  InvalidMarketplaceSignatureError,
} from '@/lib/integrations/ghl/oauth/verify-marketplace-signature'
import { marketplaceInstallSchema } from '@/lib/integrations/ghl/oauth/types'
import { connectGhlTenant } from '@/lib/core/integrations/ghl/connect-tenant'
import type { GhlOAuthCredentials } from '@/lib/integrations/ghl/oauth/types'

/**
 * Feature 008 — POST /api/webhooks/ghl/install
 *
 * Webhook do GHL Marketplace quando uma sub-account instala o app
 * Prontool. NÃO exige sessão — autenticidade via HMAC-SHA256 com
 * `GHL_MARKETPLACE_SHARED_SECRET`. AUTH_EXEMPT em lint:auth (rota está
 * sob `webhooks/`).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ProcessedInstall {
  receivedAt: Set<string>
}
const processedInstalls = new Map<string, number>()

const DEDUP_WINDOW_MS = 60 * 60 * 1000 // 1 hour

function checkInProcessIdempotency(eventId: string): boolean {
  const now = Date.now()
  // GC entries older than the window.
  for (const [k, t] of processedInstalls) {
    if (now - t > DEDUP_WINDOW_MS) processedInstalls.delete(k)
  }
  if (processedInstalls.has(eventId)) return true
  processedInstalls.set(eventId, now)
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
      logger.warn(
        { reason: err.reason },
        'ghl-marketplace-install-signature-invalid',
      )
      return jsonError(401, 'INVALID_SIGNATURE', 'Assinatura inválida')
    }
    throw err
  }

  let parsed
  try {
    parsed = marketplaceInstallSchema.parse(JSON.parse(rawBody))
  } catch (err) {
    return jsonError(400, 'INVALID_BODY', 'Payload INSTALL inválido', {
      issues: err instanceof Error ? err.message.slice(0, 300) : null,
    })
  }

  // Idempotência in-process (defense in depth — a deduplicação primária
  // é o ON CONFLICT em tenant_integrations + UNIQUE em location_id).
  if (checkInProcessIdempotency(parsed.eventId)) {
    return jsonOk({ received: true, duplicate: true })
  }

  const supabase = createSupabaseServiceClient()

  // Resolve tenant: location_id já mapeada → reusa; senão, novo tenant.
  let tenantId: string
  const { data: existing } = await supabase
    .from('tenant_integrations')
    .select('tenant_id')
    .eq('provider', 'ghl')
    .eq('location_id', parsed.locationId)
    .maybeSingle()
  if (existing?.tenant_id) {
    tenantId = existing.tenant_id
  } else {
    tenantId = randomUUID()
  }

  const credentials: GhlOAuthCredentials = {
    access_token: parsed.tokens.access_token,
    refresh_token: parsed.tokens.refresh_token,
    expires_at: new Date(Date.now() + parsed.tokens.expires_in * 1000).toISOString(),
    scopes: parsed.tokens.scope.split(/[\s,]+/).filter((s) => s.length > 0),
    user_type: 'Location',
    location_id: parsed.locationId,
    company_id: parsed.companyId,
    user_id: parsed.user?.id ?? '',
  }

  try {
    await connectGhlTenant({
      supabase,
      source: 'marketplace_install',
      actorUserId: null,
      actorLabel: 'system:ghl_marketplace_install',
      tenantId,
      credentials,
      location: {
        id: parsed.location.id,
        name: parsed.location.name,
        timezone: parsed.location.timezone ?? null,
      },
      ensureTenantExists: existing === null,
    })
  } catch (err) {
    // Race conditional: dois INSTALL simultâneos para mesma location.
    // O 2º bate em UNIQUE (tenant_integrations_unique_active_location_id)
    // e cai aqui — re-resolvemos e reusamos o tenant criado pela 1ª.
    const message = err instanceof Error ? err.message : String(err)
    if (/unique/i.test(message) && /location_id/i.test(message)) {
      const { data: retry } = await supabase
        .from('tenant_integrations')
        .select('tenant_id')
        .eq('provider', 'ghl')
        .eq('location_id', parsed.locationId)
        .maybeSingle()
      if (retry?.tenant_id) {
        await connectGhlTenant({
          supabase,
          source: 'marketplace_install',
          actorUserId: null,
          actorLabel: 'system:ghl_marketplace_install',
          tenantId: retry.tenant_id,
          credentials,
          location: {
            id: parsed.location.id,
            name: parsed.location.name,
            timezone: parsed.location.timezone ?? null,
          },
          ensureTenantExists: false,
        })
        return jsonOk({ received: true, duplicate: false, tenant_id: retry.tenant_id })
      }
    }
    logger.error(
      { err: message, event_id: parsed.eventId, location_id: parsed.locationId },
      'ghl-marketplace-install-failed',
    )
    return jsonError(500, 'INSTALL_FAILED', 'Falha ao processar install. Verifique logs.')
  }

  return jsonOk({ received: true, duplicate: false, tenant_id: tenantId })
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
  return new Response(
    JSON.stringify({ error: { code, message, ...extra } }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}
