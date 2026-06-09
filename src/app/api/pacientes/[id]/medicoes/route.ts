/**
 * Feature 030 — /api/pacientes/[id]/medicoes (staff).
 *
 * GET: lista as medições do paciente agrupadas por métrica (todos os papéis).
 * POST: registra uma medição metabólica (FR-011) — só admin/profissional_saude
 * (FR-014). Valor fora da faixa plausível → 422 com mensagem clara (FR-013).
 * Append-only: não há PATCH/DELETE (FR-012) — correção é nova medição.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  listMeasurements,
  recordMeasurement,
} from '@/lib/core/patient-portal/measurements'
import { listEnabledMetricTypesForTenant } from '@/lib/core/patient-portal/metric-types'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  metric_type: z.string().min(2).max(64),
  value: z.number().finite(),
  unit: z.string().max(16).optional().nullable(),
  measured_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO AAAA-MM-DD'),
  notes: z.string().max(2000).optional().nullable(),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/medicoes`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'patient_measurements', entityId: params.id, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const [measurements, metricTypes] = await Promise.all([
      listMeasurements(supabase, { tenantId: session.tenantId, patientId: params.id }),
      listEnabledMetricTypesForTenant(supabase, session.tenantId, { specialty: 'endocrino' }),
    ])
    return NextResponse.json({ measurements, metricTypes }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/medicoes`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_measurements',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Payload inválido',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const { measurement } = await recordMeasurement(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      metricType: parsed.data.metric_type,
      value: parsed.data.value,
      unit: parsed.data.unit ?? null,
      measuredAt: parsed.data.measured_at,
      notes: parsed.data.notes ?? null,
      actorUserId: session.userId,
    })
    return NextResponse.json(measurement, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
