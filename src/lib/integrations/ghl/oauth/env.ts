/**
 * Feature 008 — Único ponto autorizado a ler `process.env.GHL_*` vars
 * relacionadas a OAuth/Marketplace/SSO. Reforçado por `pnpm lint:auth`:
 * qualquer arquivo dentro de `src/lib/integrations/**` fora de
 * `src/lib/integrations/ghl/oauth/**` que tente ler essas variáveis
 * falha o lint. Adapters recebem credentials per-tenant via
 * `withGhlAuth` ou `AdapterContext`.
 */

class OauthConfigMissingError extends Error {
  readonly code = 'OAUTH_CONFIG_MISSING'
  constructor(missing: string[]) {
    super(`GHL OAuth env vars ausentes: ${missing.join(', ')}`)
    this.name = 'OauthConfigMissingError'
  }
}

export interface GhlOAuthEnv {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Lista normalizada — aceita CSV ou separado por espaço. */
  scopes: string[]
  marketplaceSharedSecret: string
}

/**
 * Lê e valida as 5 vars obrigatórias para o fluxo OAuth + Marketplace.
 * Lança `OAUTH_CONFIG_MISSING` se faltar qualquer uma. Variáveis
 * SSO-only (`GHL_SSO_*`) ficam em `readGhlSsoEnv()` separado para
 * que rotas que não tocam SSO não falhem.
 */
export function readGhlOAuthEnv(): GhlOAuthEnv {
  const env = {
    GHL_CLIENT_ID: process.env.GHL_CLIENT_ID,
    GHL_CLIENT_SECRET: process.env.GHL_CLIENT_SECRET,
    GHL_REDIRECT_URI: process.env.GHL_REDIRECT_URI,
    GHL_SCOPES: process.env.GHL_SCOPES,
    GHL_MARKETPLACE_SHARED_SECRET: process.env.GHL_MARKETPLACE_SHARED_SECRET,
  }
  const missing = Object.entries(env)
    .filter(([, v]) => !v || v.length === 0)
    .map(([k]) => k)
  if (missing.length > 0) throw new OauthConfigMissingError(missing)

  const rawScopes = (env.GHL_SCOPES as string).trim()
  const scopes = rawScopes
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (scopes.length === 0) throw new OauthConfigMissingError(['GHL_SCOPES (vazio)'])

  return {
    clientId: env.GHL_CLIENT_ID as string,
    clientSecret: env.GHL_CLIENT_SECRET as string,
    redirectUri: env.GHL_REDIRECT_URI as string,
    scopes,
    marketplaceSharedSecret: env.GHL_MARKETPLACE_SHARED_SECRET as string,
  }
}

export interface GhlSsoEnv {
  jwksUrl: string
  /** Audience esperada no claim `aud` do JWT — sempre o GHL_CLIENT_ID. */
  audience: string
}

export function readGhlSsoEnv(): GhlSsoEnv {
  const url = process.env.GHL_SSO_JWKS_URL
  const audience = process.env.GHL_CLIENT_ID
  const missing: string[] = []
  if (!url) missing.push('GHL_SSO_JWKS_URL')
  if (!audience) missing.push('GHL_CLIENT_ID')
  if (missing.length > 0) throw new OauthConfigMissingError(missing)
  return { jwksUrl: url as string, audience: audience as string }
}

/**
 * Para o cookie de state HMAC. Reusamos `SUPABASE_JWT_SECRET` (já obrigatório
 * no projeto) em vez de inventar mais uma var. Não vaza secret de auth do
 * Supabase: o HMAC é criado e verificado server-side; clients só veem o
 * digest opaco.
 */
export function readStateSigningKey(): string {
  const k = process.env.SUPABASE_JWT_SECRET
  if (!k) throw new OauthConfigMissingError(['SUPABASE_JWT_SECRET'])
  return k
}

export { OauthConfigMissingError }
