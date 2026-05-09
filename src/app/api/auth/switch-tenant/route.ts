import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { switchActiveTenant } from '@/lib/core/auth/switch-tenant'
import { toHttpResponse } from '@/lib/observability/http'
import { TENANT_ROLES_ORDERED } from '@/lib/core/team/types'
import type { Database, TenantRole } from '@/lib/db/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Feature 010 (US3) — POST /api/auth/switch-tenant
 *
 * Troca a clínica ativa da sessão (R5). Cliente deve chamar
 * supabase.auth.refreshSession() após o 200 para regerar o JWT.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(TENANT_ROLES_ORDERED as readonly TenantRole[], {
      entity: 'session',
      route: 'POST /api/auth/switch-tenant',
      request: req,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    })

    const body = (await req.json().catch(() => ({}))) as { tenantId?: string }
    const supabaseService = createSupabaseServiceClient() as unknown as SupabaseClient<Database>

    await switchActiveTenant(supabaseService, {
      userId: session.userId,
      tenantId: body.tenantId ?? '',
      userEmail: session.email,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toHttpResponse(err, { route: 'POST /api/auth/switch-tenant' })
  }
}
