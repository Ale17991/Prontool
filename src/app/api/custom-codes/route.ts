import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listCustomCodes, upsertCustomCode } from '@/lib/core/custom-codes'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET  /api/custom-codes — lista codigos personalizados do tenant (ativos).
 *                          Leitura para qualquer papel autenticado.
 * POST /api/custom-codes — cria (ou reusa) codigo personalizado. Admin only.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  code: z.string().trim().min(1).max(50),
  description: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(50).nullable().optional(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'custom_procedure_codes', route: '/api/custom-codes', request: req },
    )
    const supabase = createSupabaseServiceClient()
    const items = await listCustomCodes(supabase, { tenantId: session.tenantId })
    return NextResponse.json({ items }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/custom-codes' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'custom_procedure_codes',
      route: '/api/custom-codes',
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Payload inválido.',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await upsertCustomCode(supabase, {
      tenantId: session.tenantId,
      code: parsed.data.code,
      description: parsed.data.description,
      category: parsed.data.category ?? null,
      actorUserId: session.userId,
    })
    return NextResponse.json(result, { status: result.reused ? 200 : 201 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/custom-codes' })
  }
}
