import { NextResponse } from 'next/server'
import { logger } from '@/lib/observability/logger'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { exchangeCodeForTokens, CodeExchangeError } from '@/lib/integrations/ghl/oauth/client'
import {
  STATE_COOKIE_NAME,
  StateExpiredError,
  StateMismatchError,
  verifyStateCookie,
} from '@/lib/integrations/ghl/oauth/state'
import { connectGhlTenant } from '@/lib/core/integrations/ghl/connect-tenant'
import { recordSimpleIntegrationEvent } from '@/lib/core/audit/integration-events'

/**
 * Feature 008 — GET /api/oauth/ghl/callback
 *
 * Callback do GHL após autorização. Não exige sessão — autenticidade é
 * dada pelo cookie de state assinado HMAC. AUTH_EXEMPT em lint:auth
 * (`scripts/check-require-role.mjs`).
 *
 *   ?code=...&state=<nonce>
 *
 * Pipeline:
 *   1. valida state cookie + match com query → tenant_id/user_id confiáveis
 *   2. troca code por tokens (5s timeout, 1 retry em 5xx)
 *   3. connectGhlTenant (UPSERT + audit + sync_log + post-connect-setup)
 *   4. limpa cookie + redireciona para /configuracoes/integracoes/ghl
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const REDIRECT_AFTER_PATH = '/configuracoes/integracoes/ghl'

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const stateNonce = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    // GHL pode retornar `?error=access_denied` quando admin cancela.
    return redirect(REDIRECT_AFTER_PATH, { status: 'denied', error: errorParam })
  }

  if (!stateNonce) {
    return jsonError(400, 'STATE_MISSING', 'Query parameter state ausente')
  }
  if (!code) {
    return jsonError(400, 'CODE_MISSING', 'Query parameter code ausente')
  }

  const cookieValue = readStateCookieFromHeader(req.headers.get('cookie'))

  let payload
  try {
    payload = verifyStateCookie({ cookieValue, nonceFromQuery: stateNonce })
  } catch (err) {
    if (err instanceof StateExpiredError) {
      return jsonError(401, 'STATE_EXPIRED', err.message, { clearCookie: true })
    }
    if (err instanceof StateMismatchError) {
      logger.warn(
        { err: err.message, has_cookie: cookieValue !== null },
        'ghl-oauth-callback-state-mismatch',
      )
      // Audit best-effort (sem tenant identificável — pulamos audit_log,
      // que requer tenant_id NOT NULL).
      return jsonError(401, 'STATE_MISMATCH', 'OAuth state inválido', { clearCookie: true })
    }
    throw err
  }

  // Estado validado — temos tenant_id e user_id confiáveis.
  const supabase = createSupabaseServiceClient()

  let credentials
  try {
    credentials = await exchangeCodeForTokens(code)
  } catch (err) {
    const status = err instanceof CodeExchangeError ? err.status : 0
    const bodyExcerpt = err instanceof CodeExchangeError ? err.bodyExcerpt : ''
    logger.error(
      { tenant_id: payload.tenantId, status, body: bodyExcerpt },
      'ghl-oauth-callback-code-exchange-failed',
    )
    // Audit failed code exchange (tenant context disponível).
    try {
      await recordSimpleIntegrationEvent(supabase, {
        type: 'integration.refresh_failed',
        tenantId: payload.tenantId,
        provider: 'ghl',
        actorUserId: payload.userId,
        actorLabel: 'admin',
        reason: 'code exchange failed',
        detail: { status, body_excerpt: bodyExcerpt, source: 'oauth_callback' },
        result: 'denied',
      })
    } catch (auditErr) {
      logger.error({ err: auditErr }, 'ghl-oauth-callback-audit-failed')
    }
    return jsonError(
      502,
      'CODE_EXCHANGE_FAILED',
      `GHL /oauth/token retornou ${status}`,
      { clearCookie: true },
    )
  }

  // Persiste tokens + dispara post-connect-setup.
  // location_id/sub_account_name/timezone vêm do payload do token.
  // Como `/oauth/token` na maioria das integrações GHL não retorna `name`/
  // `timezone` da location, gravamos o que sabemos. UI pode complementar
  // depois com um GET /locations/{id}.
  try {
    await connectGhlTenant({
      supabase,
      source: 'manual_connect',
      actorUserId: payload.userId,
      actorLabel: 'admin',
      tenantId: payload.tenantId,
      credentials,
      location: {
        id: credentials.location_id,
        // Sem nome em /oauth/token — UI mostra `location_id` até o
        // próximo fetch popular. Não é PII, é safe.
        name: credentials.location_id,
        timezone: null,
      },
    })
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenant_id: payload.tenantId },
      'ghl-oauth-callback-connect-failed',
    )
    return jsonError(
      500,
      'CONNECT_FAILED',
      'Falha ao persistir conexão. Verifique logs.',
      { clearCookie: true },
    )
  }

  return redirect(REDIRECT_AFTER_PATH, { status: 'connected' }, { clearCookie: true })
}

function readStateCookieFromHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  // Parse minimal (sem deps): chave=value;chave=value
  const parts = cookieHeader.split(';')
  for (const part of parts) {
    const [rawK, ...rest] = part.split('=')
    const k = rawK?.trim()
    if (k === STATE_COOKIE_NAME) {
      const raw = rest.join('=').trim()
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
  }
  return null
}

function clearCookieHeader(): string {
  return [
    `${STATE_COOKIE_NAME}=`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/api/oauth/ghl',
    'Max-Age=0',
  ].join('; ')
}

function redirect(
  path: string,
  query: Record<string, string>,
  opts: { clearCookie?: boolean } = {},
): Response {
  const params = new URLSearchParams(query).toString()
  const headers: Record<string, string> = {
    Location: `${path}?${params}`,
    'Cache-Control': 'no-store',
  }
  if (opts.clearCookie) headers['Set-Cookie'] = clearCookieHeader()
  return new Response(null, { status: 302, headers })
}

function jsonError(
  status: number,
  code: string,
  message: string,
  opts: { clearCookie?: boolean } = {},
): Response {
  const body = JSON.stringify({ error: { code, message } })
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.clearCookie) headers['Set-Cookie'] = clearCookieHeader()
  return new Response(body, { status, headers })
}
