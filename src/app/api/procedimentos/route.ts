import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listProcedures } from '@/lib/core/procedures/list'
import { createProcedure } from '@/lib/core/procedures/create'
import { denyAudit } from '@/lib/core/audit/deny'
import { TussCodeInvalidError, ConflictError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T164 — GET / POST /api/procedimentos. Leitura pra todos os papéis
 * com `procedure.read`; escrita só admin (validação TUSS no trigger
 * da migration 0014 + denyAudit em rejeição).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  include_inactive: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
})

const createSchema = z.object({
  tuss_code: z.string().min(1),
  display_name: z.string().nullable().optional(),
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'procedures', route: '/api/procedimentos', request: req },
    )
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const list = await listProcedures(supabase, {
      tenantId: session.tenantId,
      includeInactive: parsed.data.include_inactive,
    })
    return NextResponse.json(list, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/procedimentos' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'procedures',
      route: '/api/procedimentos',
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    try {
      const created = await createProcedure(supabase, {
        tenantId: session.tenantId,
        tussCode: parsed.data.tuss_code,
        displayName: parsed.data.display_name ?? null,
      })
      return NextResponse.json(
        {
          id: created.id,
          tuss_code: created.tussCode,
          display_name: created.displayName,
          active: created.active,
          created_at: created.createdAt,
        },
        { status: 201 },
      )
    } catch (err) {
      if (err instanceof TussCodeInvalidError) {
        await denyAudit({
          tenantId: session.tenantId,
          actorId: session.userId,
          actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
          entity: 'procedures',
          reason: `TUSS inválido: ${parsed.data.tuss_code}`,
          result: 'denied',
        })
        return NextResponse.json(
          { error: { code: err.code, message: err.message, meta: err.meta } },
          { status: 400 },
        )
      }
      if (err instanceof ConflictError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, meta: err.meta } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: '/api/procedimentos' })
  }
}
