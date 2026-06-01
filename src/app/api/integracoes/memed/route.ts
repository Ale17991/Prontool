import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { connectMemed, disconnectMemed } from '@/lib/core/integrations/memed/connect'
import { setMemedEnvironment } from '@/lib/core/integrations/memed/environment'
import { memedCredentialsSchema, memedEnvironmentSchema } from '@/lib/core/integrations/memed/types'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST   /api/integracoes/memed  → conectar (homologação), admin-only.
 * PATCH  /api/integracoes/memed  → trocar ambiente (staging/production), admin-only.
 * DELETE /api/integracoes/memed  → desconectar, admin-only.
 *
 * Segurança: o corpo recebe as chaves UMA vez (HTTPS) e elas são cifradas
 * server-side. NENHUMA resposta jamais devolve as chaves.
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

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'tenant_memed_config',
      route: ROUTE,
      request: req,
    })
    const parsed = memedCredentialsSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Informe api_key e secret_key.', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await connectMemed({
      supabase,
      tenantId: session.tenantId,
      credentials: parsed.data,
      actorUserId: session.userId,
      actorLabel: actorLabel(session.email, session.userId),
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    })
    // Resposta NUNCA inclui chaves — só estado público.
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
    const result = await disconnectMemed({
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
