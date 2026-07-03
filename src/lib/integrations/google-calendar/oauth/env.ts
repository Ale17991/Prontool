/**
 * Google Calendar — único ponto autorizado a ler `process.env.GOOGLE_*`.
 * Mesma disciplina da cápsula GHL: o resto da app recebe tokens já resolvidos
 * via `withGoogleAuth`. Em produção exige um OAuth client (Web application) no
 * Google Cloud com a Calendar API habilitada e o escopo calendar.events.
 */

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

class GoogleOAuthConfigMissingError extends Error {
  readonly code = 'GOOGLE_OAUTH_CONFIG_MISSING'
  constructor(missing: string[]) {
    super(`Google OAuth env vars ausentes: ${missing.join(', ')}`)
    this.name = 'GoogleOAuthConfigMissingError'
  }
}

export interface GoogleOAuthEnv {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function readGoogleOAuthEnv(): GoogleOAuthEnv {
  const env = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  }
  const missing = Object.entries(env)
    .filter(([, v]) => !v || v.length === 0)
    .map(([k]) => k)
  if (missing.length > 0) throw new GoogleOAuthConfigMissingError(missing)
  return {
    clientId: env.GOOGLE_CLIENT_ID as string,
    clientSecret: env.GOOGLE_CLIENT_SECRET as string,
    redirectUri: env.GOOGLE_REDIRECT_URI as string,
  }
}

/** `true` se as vars do Google estão configuradas (para esconder a UI quando não). */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI,
  )
}

/** Chave do cookie de state HMAC — reusa SUPABASE_JWT_SECRET (já obrigatório). */
export function readStateSigningKey(): string {
  const k = process.env.SUPABASE_JWT_SECRET
  if (!k) throw new GoogleOAuthConfigMissingError(['SUPABASE_JWT_SECRET'])
  return k
}

export { GoogleOAuthConfigMissingError }
