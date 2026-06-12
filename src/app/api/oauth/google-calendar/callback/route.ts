import { cookies } from 'next/headers'
import { toHttpResponse } from '@/lib/observability/http'
import { logger } from '@/lib/observability/logger'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { exchangeCode, fetchAccountEmail } from '@/lib/integrations/google-calendar/oauth/client'
import { verifyStateCookie, STATE_COOKIE_NAME } from '@/lib/integrations/google-calendar/oauth/state'
import { writeGoogleConnection } from '@/lib/integrations/google-calendar/oauth/token-store'
import { googleCalendarConfigSchema } from '@/lib/integrations/google-calendar/oauth/types'

/**
 * GET /api/oauth/google-calendar/callback
 * Recebe o `code` do Google, valida o state (cookie HMAC), troca por tokens e
 * persiste a conexão do usuário. Redireciona de volta à tela de configuração.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SETTINGS_PATH = '/configuracoes/google-agenda'

function redirect(to: string, clearCookie = true): Response {
  const headers: Record<string, string> = { Location: to, 'Cache-Control': 'no-store' }
  if (clearCookie) {
    headers['Set-Cookie'] = `${STATE_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/google-calendar; Max-Age=0`
  }
  return new Response(null, { status: 302, headers })
}

export async function GET(req: Request): Promise<Response> {
  const route = '/api/oauth/google-calendar/callback'
  try {
    const url = new URL(req.url)
    const error = url.searchParams.get('error')
    if (error) return redirect(`${SETTINGS_PATH}?error=${encodeURIComponent(error)}`)

    const code = url.searchParams.get('code')
    const nonce = url.searchParams.get('state')
    const cookieValue = cookies().get(STATE_COOKIE_NAME)?.value ?? null

    const state = verifyStateCookie({ cookieValue, nonceFromQuery: nonce })
    if (!code) return redirect(`${SETTINGS_PATH}?error=missing_code`)

    const credentials = await exchangeCode(code)
    const email = await fetchAccountEmail(credentials.access_token)
    const config = googleCalendarConfigSchema.parse({
      calendar_id: 'primary',
      account_email: email ?? undefined,
    })

    const supabase = createSupabaseServiceClient()
    await writeGoogleConnection(supabase, {
      userId: state.userId,
      tenantId: state.tenantId,
      credentials,
      config,
    })

    return redirect(`${SETTINGS_PATH}?connected=1`)
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'google-calendar-callback-failed')
    return redirect(`${SETTINGS_PATH}?error=connect_failed`)
  }
}
