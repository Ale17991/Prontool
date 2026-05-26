import { NextResponse } from 'next/server'
import { logger } from '@/lib/observability/logger'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  InvalidSsoTokenError,
  verifySsoToken,
} from '@/lib/integrations/ghl/oauth/verify-sso-token'
import { recordSimpleIntegrationEvent } from '@/lib/core/audit/integration-events'

/**
 * Feature 008 — GET /api/sso/ghl
 *
 * Endpoint chamado quando o usuário GHL clica no Custom Menu na sub-account.
 * Valida o JWT de contexto, identifica o tenant pela `location_id`, e
 * redireciona para `/login?next=/&sso_origin=ghl` com um cookie
 * `clinni_sso_origin` (HttpOnly, SameSite=None, Secure) que sinaliza
 * ao layout do dashboard que a sessão foi originada via GHL — ativa
 * `frame-ancestors` permissivos pra iframe.
 *
 * **Auto-login completo (sem digitar credenciais Supabase) é pós-MVP** —
 * decisão arquitetural sobre como mintar JWT compatível com `@supabase/ssr`
 * cookies sem regredir o modelo de auth foi adiada. Por enquanto o usuário
 * loga uma vez no domínio do Clinni e a sessão Supabase persiste no
 * iframe via cookie SameSite=None.
 *
 * AUTH_EXEMPT em lint:auth (rota está sob `sso/ghl`).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SSO_ORIGIN_COOKIE = 'clinni_sso_origin'
const SSO_ORIGIN_COOKIE_MAX_AGE = 60 * 60 * 8 // 8h, mesmo TTL típico de sessão.

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const contextToken = url.searchParams.get('context_token')
  if (!contextToken) {
    return jsonError(400, 'CONTEXT_TOKEN_MISSING', 'Query parameter context_token ausente.')
  }

  const redirectTo = sanitizeRedirectTo(url.searchParams.get('redirect_to'))

  let claims
  try {
    claims = await verifySsoToken(contextToken)
  } catch (err) {
    if (err instanceof InvalidSsoTokenError) {
      logger.warn({ reason: err.reason }, 'sso-ghl-invalid-context-token')
      return jsonError(401, 'INVALID_CONTEXT_TOKEN', 'Token de contexto inválido.')
    }
    throw err
  }

  // Identifica tenant pela location_id mapeada.
  const supabase = createSupabaseServiceClient()
  const { data: row } = await supabase
    .from('tenant_integrations')
    .select('tenant_id')
    .eq('provider', 'ghl')
    .eq('location_id', claims.locationId)
    .eq('enabled', true)
    .maybeSingle()
  if (!row?.tenant_id) {
    return jsonError(
      401,
      'TENANT_NOT_CONNECTED',
      'Sub-account sem integração ativa. Reconecte no Clinni.',
    )
  }

  // Audit (best-effort).
  try {
    await recordSimpleIntegrationEvent(supabase, {
      type: 'sso.login',
      tenantId: row.tenant_id,
      provider: 'ghl',
      actorUserId: null,
      actorLabel: `system:ghl_sso:${claims.userId}`,
      reason: 'GHL Marketplace SSO',
      detail: {
        location_id: claims.locationId,
        ghl_user_id: claims.userId,
        ghl_user_type: claims.userType ?? 'Location',
      },
    })
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'sso-ghl-audit-failed',
    )
  }

  // Set cookie marker + redirect to /login. Layout do dashboard lê o cookie
  // e ajusta CSP `frame-ancestors` para permitir iframe do GHL.
  const headers: Record<string, string> = {
    Location: `/login?next=${encodeURIComponent(redirectTo)}&sso_origin=ghl`,
    'Cache-Control': 'no-store',
    'Set-Cookie': [
      `${SSO_ORIGIN_COOKIE}=ghl`,
      'HttpOnly',
      'Secure',
      'SameSite=None',
      'Path=/',
      `Max-Age=${SSO_ORIGIN_COOKIE_MAX_AGE}`,
    ].join('; '),
    'Content-Security-Policy':
      "frame-ancestors https://app.gohighlevel.com https://*.gohighlevel.com",
  }
  return new Response(null, { status: 302, headers })
}

function sanitizeRedirectTo(raw: string | null): string {
  if (!raw) return '/'
  // Aceita apenas paths absolutos relativos ao Clinni (evita open redirect).
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}
