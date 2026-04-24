/**
 * Legacy path retained for back-compat with already-configured GHL webhook
 * URLs out in the wild. Thin-forwards to the generic /api/webhooks/[provider]
 * handler with provider='ghl'. All inbound logic lives in the GHL adapter
 * (src/lib/integrations/ghl/adapter.ts → handleInboundWebhook).
 */
import { POST as handleProviderWebhook } from '../[provider]/route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  return handleProviderWebhook(req, { params: { provider: 'ghl' } })
}
