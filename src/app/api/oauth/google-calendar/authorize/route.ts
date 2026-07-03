import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { toHttpResponse } from '@/lib/observability/http'
import { TENANT_ROLES_ORDERED } from '@/lib/core/team/types'
import type { TenantRole } from '@/lib/db/types'
import { isGoogleOAuthConfigured } from '@/lib/integrations/google-calendar/oauth/env'
import { buildAuthorizeUrl } from '@/lib/integrations/google-calendar/oauth/client'
import {
  createStateCookie,
  STATE_COOKIE_NAME,
  STATE_COOKIE_MAX_AGE_SECONDS,
} from '@/lib/integrations/google-calendar/oauth/state'

/**
 * GET /api/oauth/google-calendar/authorize
 * Inicia a conexão da agenda Google do PROFISSIONAL logado. Qualquer membro
 * ativo da clínica pode conectar a própria conta. State HMAC em cookie HttpOnly.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  const route = '/api/oauth/google-calendar/authorize'
  try {
    const session = await requireRole(TENANT_ROLES_ORDERED as readonly TenantRole[], {
      entity: 'user_integrations',
      route,
      request: req,
    })
    if (!isGoogleOAuthConfigured()) {
      return NextResponse.json(
        {
          error: {
            code: 'OAUTH_CONFIG_MISSING',
            message: 'Google Calendar não configurado. Defina as variáveis GOOGLE_* no ambiente.',
          },
        },
        { status: 500 },
      )
    }

    const { cookieValue, nonce } = createStateCookie({
      userId: session.userId,
      tenantId: session.tenantId,
    })
    const cookieHeader = [
      `${STATE_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Path=/api/oauth/google-calendar',
      `Max-Age=${STATE_COOKIE_MAX_AGE_SECONDS}`,
    ].join('; ')

    return new Response(null, {
      status: 302,
      headers: {
        Location: buildAuthorizeUrl(nonce),
        'Set-Cookie': cookieHeader,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
