import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { generateUserNotifications } from '@/lib/core/notifications/generate'
import { listNotifications } from '@/lib/core/notifications/list'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 012 — US2 — GET /api/notificacoes.
 * Dispara geração lazy (idempotente) e retorna lista + resumo.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'notifications', route: '/api/notificacoes', request: req },
    )
    const supabase = createSupabaseServiceClient()
    // Lazy generate. Best-effort: erro aqui não impede listar o que já existe.
    try {
      await generateUserNotifications(supabase, {
        tenantId: session.tenantId,
        userId: session.userId,
      })
    } catch {
      // Ignora — listagem segue.
    }
    const result = await listNotifications(supabase, {
      tenantId: session.tenantId,
      userId: session.userId,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/notificacoes' })
  }
}
