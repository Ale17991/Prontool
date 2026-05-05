import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { logger } from '@/lib/observability/logger'
import { readGhlOAuthEnv } from '@/lib/integrations/ghl/oauth/env'
import {
  createStateCookie,
  STATE_COOKIE_MAX_AGE_SECONDS,
  STATE_COOKIE_NAME,
} from '@/lib/integrations/ghl/oauth/state'
import { GHL_OAUTH_CHOOSE_LOCATION_URL } from '@/lib/integrations/ghl/oauth/types'

/**
 * Feature 008 — GET /api/oauth/ghl/authorize
 *
 * Inicia o fluxo OAuth manual. Admin clica "Conectar" → 302 para a tela
 * de consentimento do GHL Marketplace. State assinado HMAC viaja em
 * cookie HttpOnly; nonce no `state=` da query.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  const route = '/api/oauth/ghl/authorize'
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_integrations',
      route,
      request: req,
    })

    let env
    try {
      env = readGhlOAuthEnv()
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), tenant_id: session.tenantId },
        'ghl-oauth-authorize-config-missing',
      )
      return NextResponse.json(
        {
          error: {
            code: 'OAUTH_CONFIG_MISSING',
            message: 'GHL OAuth não configurado. Defina as variáveis GHL_* no ambiente.',
          },
        },
        { status: 500 },
      )
    }

    const { cookieValue, nonce } = createStateCookie({
      tenantId: session.tenantId,
      userId: session.userId,
    })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.clientId,
      redirect_uri: env.redirectUri,
      scope: env.scopes.join(' '),
      state: nonce,
    })
    const location = `${GHL_OAUTH_CHOOSE_LOCATION_URL}?${params.toString()}`

    const cookieHeader = [
      `${STATE_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Path=/api/oauth/ghl',
      `Max-Age=${STATE_COOKIE_MAX_AGE_SECONDS}`,
    ].join('; ')

    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        'Set-Cookie': cookieHeader,
        // Cache prevent — esse redirect carrega state único por chamada.
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
