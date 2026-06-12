import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { refreshAccessToken, GoogleTokenError } from './client'
import {
  readGoogleConnection,
  writeGoogleTokens,
  markGoogleExpired,
  type GoogleConnection,
} from './token-store'

/**
 * Garante um access_token fresco para o usuário antes de chamar a Calendar API.
 * Fast-path: token válido (>60s de folga) → usa direto. Senão renova via
 * refresh_token e persiste. Se o refresh_token foi revogado (invalid_grant),
 * marca token_expired (com CAS) e devolve `{ kind: 'needs_reconnect' }`.
 */

const LEEWAY_MS = 60_000

export type WithGoogleAuthResult =
  | { kind: 'connected'; accessToken: string; connection: GoogleConnection }
  | { kind: 'not_connected' }
  | { kind: 'needs_reconnect' }

export async function withGoogleAuth(
  supabase: SupabaseClient<Database>,
  userId: string,
  tenantId: string,
): Promise<WithGoogleAuthResult> {
  const conn = await readGoogleConnection(supabase, userId, tenantId)
  if (!conn || !conn.credentials || !conn.row.enabled) return { kind: 'not_connected' }
  if (conn.row.status === 'token_expired' || conn.row.status === 'disconnected') {
    return { kind: 'needs_reconnect' }
  }

  const expiresAtMs = Date.parse(conn.credentials.expires_at)
  if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > LEEWAY_MS) {
    return { kind: 'connected', accessToken: conn.credentials.access_token, connection: conn }
  }

  // Precisa renovar.
  try {
    const fresh = await refreshAccessToken(conn.credentials.refresh_token)
    const credentials = { ...conn.credentials, ...fresh }
    await writeGoogleTokens(supabase, { userId, tenantId, credentials })
    return {
      kind: 'connected',
      accessToken: credentials.access_token,
      connection: { ...conn, credentials },
    }
  } catch (err) {
    if (err instanceof GoogleTokenError && err.permanent) {
      await markGoogleExpired(supabase, { userId, tenantId, expectedUpdatedAt: conn.row.updated_at })
      return { kind: 'needs_reconnect' }
    }
    throw err
  }
}
