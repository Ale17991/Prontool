import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createCommissionVersion } from '@/lib/core/commissions/create-version'
import { listCommissionHistory } from '@/lib/core/commissions/list-history'
import { ConflictError, ValidationError, NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T128 — GET + POST /api/medicos/{id}/commission. GET lista histórico
 * completo (todos os papéis com doctor.read); POST cria nova versão
 * (admin-only). Append-only: UNIQUE(tenant_id, doctor_id, valid_from)
 * vira 409.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  percentage_bps: z.number().int().min(0).max(10_000),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  reason: z.string().min(3).max(500),
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'doctor_commission_history',
        entityId: params.id,
        route: `/api/medicos/${params.id}/commission`,
        request: req,
      },
    )
    const supabase = createSupabaseServiceClient()
    const rows = await listCommissionHistory(supabase, {
      tenantId: session.tenantId,
      doctorId: params.id,
    })
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        doctor_id: r.doctorId,
        percentage_bps: r.percentageBps,
        valid_from: r.validFrom,
        reason: r.reason,
        created_at: r.createdAt,
        created_by: r.createdBy,
      })),
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/medicos/${params.id}/commission` })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'doctor_commission_history',
      entityId: params.id,
      route: `/api/medicos/${params.id}/commission`,
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    try {
      const created = await createCommissionVersion(supabase, {
        tenantId: session.tenantId,
        doctorId: params.id,
        percentageBps: parsed.data.percentage_bps,
        validFrom: parsed.data.valid_from,
        reason: parsed.data.reason,
        actorUserId: session.userId,
      })
      return NextResponse.json(
        {
          id: created.id,
          doctor_id: created.doctorId,
          percentage_bps: created.percentageBps,
          valid_from: created.validFrom,
          reason: created.reason,
          created_at: created.createdAt,
        },
        { status: 201 },
      )
    } catch (err) {
      if (err instanceof ConflictError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, meta: err.meta } },
          { status: 409 },
        )
      }
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, meta: err.meta } },
          { status: 400 },
        )
      }
      if (err instanceof NotFoundError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: 404 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: `/api/medicos/${params.id}/commission` })
  }
}
