import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listCustomTables, upsertCustomTable } from '@/lib/core/custom-tables'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET  /api/custom-tables — lista tabelas personalizadas (ativas) do tenant.
 *                            Qualquer papel autenticado.
 * POST /api/custom-tables — cria (ou reusa) tabela personalizada. Admin only.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300).nullable().optional(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'custom_procedure_tables', route: '/api/custom-tables', request: req },
    )
    const supabase = createSupabaseServiceClient()
    const items = await listCustomTables(supabase, { tenantId: session.tenantId })
    return NextResponse.json({ items }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/custom-tables' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'custom_procedure_tables',
      route: '/api/custom-tables',
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido.', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await upsertCustomTable(supabase, {
      tenantId: session.tenantId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      actorUserId: session.userId,
    })
    return NextResponse.json(result, { status: result.reused ? 200 : 201 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/custom-tables' })
  }
}
