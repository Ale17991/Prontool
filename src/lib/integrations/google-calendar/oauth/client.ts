import { readGoogleOAuthEnv, GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_FULL_SCOPE } from './env'
import { logger } from '@/lib/observability/logger'
import { googleOAuthCredentialsSchema, type GoogleOAuthCredentials } from './types'

/**
 * Chamadas diretas (fetch nativo) aos endpoints OAuth do Google. Sem deps —
 * mesmo estilo do client GHL. Timeout de 10s por request.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'

export class GoogleTokenError extends Error {
  readonly code = 'GOOGLE_TOKEN_ERROR'
  /** `true` quando o refresh_token foi revogado (invalid_grant) — reconexão necessária. */
  readonly permanent: boolean
  constructor(message: string, permanent = false) {
    super(message)
    this.name = 'GoogleTokenError'
    this.permanent = permanent
  }
}

/**
 * O Google não concedeu a permissão de agenda. Erro PRÓPRIO (e não um
 * `GoogleTokenError`) porque o conserto é do usuário, não do sistema: ele
 * precisa reconectar marcando a caixa — e a tela só consegue dizer isso se
 * conseguir distinguir este caso de uma falha genérica.
 */
export class GoogleScopeMissingError extends Error {
  readonly code = 'GOOGLE_SCOPE_MISSING'
  /** O que o Google efetivamente concedeu (para diagnóstico no log). */
  readonly granted: readonly string[]
  constructor(granted: readonly string[]) {
    super(
      `Permissão de agenda não concedida. Escopos recebidos: ${granted.join(', ') || '(nenhum)'}`,
    )
    this.name = 'GoogleScopeMissingError'
    this.granted = granted
  }
}

/** `calendar` (total) implica `calendar.events` — quem concedeu MAIS não é recusado. */
export function grantsCalendarWrite(granted: readonly string[]): boolean {
  return granted.includes(GOOGLE_CALENDAR_SCOPE) || granted.includes(GOOGLE_CALENDAR_FULL_SCOPE)
}

/** URL de consentimento. `state` é o nonce assinado no cookie. */
export function buildAuthorizeUrl(state: string): string {
  const env = readGoogleOAuthEnv()
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: 'code',
    scope: `${GOOGLE_CALENDAR_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
    access_type: 'offline', // pede refresh_token
    prompt: 'consent', // garante refresh_token mesmo em reconexão
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

function expiresAtFrom(expiresInSec: number): string {
  return new Date(Date.now() + expiresInSec * 1000).toISOString()
}

/** Troca o `code` do callback por tokens. */
export async function exchangeCode(code: string): Promise<GoogleOAuthCredentials> {
  const env = readGoogleOAuthEnv()
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10000),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || typeof json.access_token !== 'string') {
    throw new GoogleTokenError(`exchangeCode falhou: ${res.status} ${JSON.stringify(json)}`)
  }
  if (typeof json.refresh_token !== 'string') {
    // Sem refresh_token não conseguimos manter a conexão — força reconsentir.
    throw new GoogleTokenError(
      'Google não retornou refresh_token (reconecte concedendo acesso offline).',
    )
  }

  // O escopo é concedido A ESCOLHA DO USUÁRIO: a tela de permissões granulares
  // do Google mostra uma caixa por escopo, e a da agenda vem DESMARCADA. Sem
  // esta checagem gravávamos como "conectada" uma conta que só concedeu o
  // e-mail — o card dizia que estava tudo certo, e a falha só emergia no
  // primeiro atendimento, como um 403 dentro de
  // `appointment_calendar_sync.last_error` que ninguém olha. Aconteceu em
  // 2026-08-14, com o primeiro profissional conectado.
  if (typeof json.scope === 'string') {
    const granted = json.scope.split(/\s+/).filter(Boolean)
    if (!grantsCalendarWrite(granted)) throw new GoogleScopeMissingError(granted)
  } else {
    // Ausência do campo não é prova de recusa: o Google sempre o devolve nesta
    // troca, e recusar por um campo que sumiu quebraria TODAS as conexões numa
    // eventual mudança da resposta dele. Registra e segue — o 403 no primeiro
    // evento continua sendo a rede de baixo.
    logger.warn({}, 'google-calendar-token-sem-campo-scope')
  }

  return googleOAuthCredentialsSchema.parse({
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: expiresAtFrom(Number(json.expires_in ?? 3600)),
    scope: typeof json.scope === 'string' ? json.scope : undefined,
    token_type: typeof json.token_type === 'string' ? json.token_type : undefined,
  })
}

/** Renova o access_token a partir do refresh_token (que é preservado). */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<Omit<GoogleOAuthCredentials, 'refresh_token'>> {
  const env = readGoogleOAuthEnv()
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10000),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || typeof json.access_token !== 'string') {
    const permanent = json.error === 'invalid_grant'
    throw new GoogleTokenError(
      `refreshAccessToken falhou: ${res.status} ${JSON.stringify(json)}`,
      permanent,
    )
  }
  return {
    access_token: json.access_token,
    expires_at: expiresAtFrom(Number(json.expires_in ?? 3600)),
    scope: typeof json.scope === 'string' ? json.scope : undefined,
    token_type: typeof json.token_type === 'string' ? json.token_type : undefined,
  }
}

/** E-mail da conta conectada (para exibir na UI). Best-effort. */
export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { email?: string }
    return json.email ?? null
  } catch {
    return null
  }
}
