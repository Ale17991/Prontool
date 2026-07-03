import { logger } from '@/lib/observability/logger'
import { readGhlOAuthEnv } from './env'
import {
  GHL_OAUTH_TOKEN_URL,
  GHL_TOKEN_REFRESH_LEEWAY_MS,
  ghlOAuthCredentialsSchema,
  type GhlOAuthCredentials,
} from './types'

/**
 * Feature 008 — Cliente HTTP para o endpoint `/oauth/token` do GHL.
 *
 * Encapsula `exchangeCodeForTokens` (authorization_code) e `refreshTokens`
 * (refresh_token) com timeout de 5 s, 1 retry para 5xx/timeout, e
 * tratamento distinto de 4xx (erro permanente — refresh_token revogado /
 * code já consumido) vs 5xx (transient).
 */

const REQUEST_TIMEOUT_MS = 5_000

export class CodeExchangeError extends Error {
  readonly code = 'CODE_EXCHANGE_FAILED'
  readonly status: number
  readonly bodyExcerpt: string
  constructor(status: number, bodyExcerpt: string) {
    super(`GHL /oauth/token (authorization_code) returned ${status}`)
    this.name = 'CodeExchangeError'
    this.status = status
    this.bodyExcerpt = bodyExcerpt
  }
}

export class RefreshError extends Error {
  readonly code = 'REFRESH_FAILED'
  readonly status: number
  readonly transient: boolean
  readonly bodyExcerpt: string
  constructor(status: number, transient: boolean, bodyExcerpt: string) {
    super(
      `GHL /oauth/token (refresh_token) returned ${status} (${transient ? 'transient' : 'permanent'})`,
    )
    this.name = 'RefreshError'
    this.status = status
    this.transient = transient
    this.bodyExcerpt = bodyExcerpt
  }
}

interface RawTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
  userType: 'Location' | 'Company'
  locationId: string
  companyId: string
  userId: string
}

/**
 * Troca um `code` recebido no callback OAuth por um par
 * `access_token + refresh_token`. Lança `CodeExchangeError` em qualquer
 * falha — caller decide se faz fallback ou propaga.
 */
export async function exchangeCodeForTokens(code: string): Promise<GhlOAuthCredentials> {
  const env = readGhlOAuthEnv()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    code,
    user_type: 'Location',
  })
  const raw = await postOauthToken(body, /* allowRetryOn5xx */ true)
  return rawToCredentials(raw)
}

/**
 * Renova o par de tokens usando `refresh_token`. Distingue:
 * - 4xx → refresh_token revogado / inválido → permanente. Caller deve
 *   marcar `status='token_expired'` e parar de tentar até reconexão.
 * - 5xx / timeout → transient. Caller pode esperar próxima chamada.
 */
export async function refreshTokens(refreshToken: string): Promise<GhlOAuthCredentials> {
  const env = readGhlOAuthEnv()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: refreshToken,
    user_type: 'Location',
  })
  const raw = await postOauthTokenForRefresh(body)
  return rawToCredentials(raw)
}

async function postOauthToken(
  body: URLSearchParams,
  allowRetryOn5xx: boolean,
): Promise<RawTokenResponse> {
  let attempt = 0
  while (true) {
    attempt += 1
    let res: Response
    try {
      res = await fetch(GHL_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      if (allowRetryOn5xx && attempt === 1) {
        await sleep(backoffMs(attempt))
        continue
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new CodeExchangeError(0, `network_error: ${message}`)
    }

    if (res.ok) {
      return (await res.json()) as RawTokenResponse
    }
    const excerpt = await readBodyExcerpt(res)
    if (res.status >= 500 && allowRetryOn5xx && attempt === 1) {
      logger.warn({ status: res.status, attempt }, 'ghl-oauth-token-5xx-retrying')
      await sleep(backoffMs(attempt))
      continue
    }
    throw new CodeExchangeError(res.status, excerpt)
  }
}

async function postOauthTokenForRefresh(body: URLSearchParams): Promise<RawTokenResponse> {
  let attempt = 0
  while (true) {
    attempt += 1
    let res: Response
    try {
      res = await fetch(GHL_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      if (attempt === 1) {
        await sleep(backoffMs(attempt))
        continue
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new RefreshError(0, /*transient*/ true, `network_error: ${message}`)
    }

    if (res.ok) {
      return (await res.json()) as RawTokenResponse
    }
    const excerpt = await readBodyExcerpt(res)
    const transient = res.status >= 500
    if (transient && attempt === 1) {
      logger.warn({ status: res.status, attempt }, 'ghl-oauth-refresh-5xx-retrying')
      await sleep(backoffMs(attempt))
      continue
    }
    throw new RefreshError(res.status, transient, excerpt)
  }
}

function rawToCredentials(raw: RawTokenResponse): GhlOAuthCredentials {
  // expires_in vem em segundos; aplicamos LEEWAY interno para criar a janela
  // de refresh proativo (sem subtrair do banco — o banco guarda o real).
  const expiresAtMs = Date.now() + raw.expires_in * 1000
  const scopes =
    typeof raw.scope === 'string' && raw.scope.length > 0
      ? raw.scope.split(/[\s,]+/).filter((s) => s.length > 0)
      : []
  const candidate = {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: new Date(expiresAtMs).toISOString(),
    scopes,
    user_type: raw.userType,
    location_id: raw.locationId,
    company_id: raw.companyId,
    user_id: raw.userId,
  }
  return ghlOAuthCredentialsSchema.parse(candidate)
}

async function readBodyExcerpt(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, 200)
  } catch {
    return ''
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffMs(attempt: number): number {
  // 250ms, 500ms — só ajustamos a primeira retry.
  return 250 * 2 ** (attempt - 1)
}

/**
 * Re-exporta a janela de refresh proativo para outros módulos (`with-auth`).
 */
export { GHL_TOKEN_REFRESH_LEEWAY_MS }
