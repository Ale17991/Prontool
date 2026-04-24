import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getAdapter } from '@/lib/integrations/registry'

/**
 * Generic webhook entry point. Delegates to the adapter registered for
 * `[provider]`. 404 if the provider is unknown. If the adapter doesn't
 * implement inbound webhooks, 405.
 *
 * Each adapter owns its own tenant identification (signature scan, token
 * match, etc.) because the shape of the identifying signal varies by
 * provider and is often intertwined with signature verification.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: { provider: string } }

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const adapter = getAdapter(params.provider)
  if (!adapter) {
    return NextResponse.json(
      { error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider desconhecido' } },
      { status: 404 },
    )
  }
  if (!adapter.handleInboundWebhook) {
    return NextResponse.json(
      {
        error: {
          code: 'INBOUND_NOT_SUPPORTED',
          message: `Provider ${adapter.provider} does not accept inbound webhooks`,
        },
      },
      { status: 405 },
    )
  }
  const supabase = createSupabaseServiceClient()
  return adapter.handleInboundWebhook(supabase, req)
}
