import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { activateMemed, deactivateMemed } from '@/lib/core/integrations/memed/connect'
import { setMemedEnvironment } from '@/lib/core/integrations/memed/environment'
import { memedEnvironmentSchema } from '@/lib/core/integrations/memed/types'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST   /api/integracoes/memed  → ativar prescrição digital (aceite do termo
 *                                   embutido), admin-only. SEM chaves no corpo —
 *                                   as credenciais são de plataforma (env).
 * PATCH  /api/integracoes/memed  → trocar ambiente (staging/production), admin.
 * DELETE /api/integracoes/memed  → desativar, admin.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE = '/api/integracoes/memed'

function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}
function actorLabel(email: string | null, userId: string): string {
  return email ? `user:${email}` : `user:${userId}`
}

const activateSchema = z.object({
  environment: memedEnvironmentSchema,
  // O cliente confirma que o termo foi lido e aceito (a UI exige antes).
  accept_terms: z.literal(true),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_memed_config',
      route: ROUTE,
      request: req,
    })
    const parsed = activateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Aceite o termo e informe o ambiente para ativar.' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await activateMemed({
      supabase,
      tenantId: session.tenantId,
      environment: parsed.data.environment,
      actorUserId: session.userId,
      actorLabel: actorLabel(session.email, session.userId),
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json({ environment: result.environment, connected: result.connected }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_memed_config',
      route: ROUTE,
      request: req,
    })
    const parsed = z
      .object({ environment: memedEnvironmentSchema })
      .safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Informe environment (staging|production).' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await setMemedEnvironment({
      supabase,
      tenantId: session.tenantId,
      environment: parsed.data.environment,
      actorUserId: session.userId,
      actorLabel: actorLabel(session.email, session.userId),
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_memed_config',
      route: ROUTE,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const result = await deactivateMemed({
      supabase,
      tenantId: session.tenantId,
      actorUserId: session.userId,
      actorLabel: actorLabel(session.email, session.userId),
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: ROUTE })
  }
}
