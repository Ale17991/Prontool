import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createPriceVersion } from '@/lib/core/pricing/create-version'
import { denyAudit } from '@/lib/core/audit/deny'
import { PriceVersionConflictError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T112 — POST /api/precos/versions. Admin-only. Em conflito de chain
 * head ou colisão de UNIQUE(valid_from), responde 409 e MUST gravar
 * `denyAudit({ result: 'conflict' })` antes (FR-005b).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  procedure_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  amount_cents: z.number().int().min(0),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  reason: z.string().min(3),
  expected_head_id: z.string().uuid().nullable(),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'price_versions',
      route: '/api/precos/versions',
      request: req,
    })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 400 },
      )
    }
    const body = parsed.data

    const supabase = createSupabaseServiceClient()
    try {
      const version = await createPriceVersion(supabase, {
        tenantId: session.tenantId,
        procedureId: body.procedure_id,
        planId: body.plan_id,
        amountCents: body.amount_cents,
        validFrom: body.valid_from,
        reason: body.reason,
        expectedHeadId: body.expected_head_id,
        actorUserId: session.userId,
      })
      return NextResponse.json(
        {
          id: version.id,
          procedure_id: version.procedureId,
          plan_id: version.planId,
          amount_cents: version.amountCents,
          valid_from: version.validFrom,
          reason: version.reason,
          created_by: version.createdBy,
          previous_version_id: version.previousVersionId,
        },
        { status: 201 },
      )
    } catch (err) {
      if (err instanceof PriceVersionConflictError) {
        await denyAudit({
          tenantId: session.tenantId,
          actorId: session.userId,
          actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
          entity: 'price_versions',
          entityId: (err.meta?.['current_head_id'] as string | undefined) ?? undefined,
          reason: 'conflito de concorrência: chain head obsoleto',
          result: 'conflict',
        })
        return NextResponse.json(
          {
            code: err.code,
            message: err.message,
            current_head_id: err.meta?.['current_head_id'] ?? null,
          },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: '/api/precos/versions' })
  }
}
