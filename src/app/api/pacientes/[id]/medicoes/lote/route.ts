/**
 * Bioimpedância — POST /api/pacientes/[id]/medicoes/lote (staff).
 *
 * Registra VÁRIAS medições de uma sessão (ex.: um exame de bioimpedância) com
 * a mesma data. Só admin/profissional_saude (FR-014). Atômico: se algum valor
 * estiver fora da faixa plausível, 422 com a lista e nada é gravado.
 * Append-only: correção é nova sessão.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { recordMeasurementsBatch } from '@/lib/core/patient-portal/measurements'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const batchSchema = z.object({
  measured_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO AAAA-MM-DD'),
  notes: z.string().max(2000).optional().nullable(),
  entries: z
    .array(
      z.object({
        metric_type: z.string().min(2).max(64),
        value: z.number().finite(),
        unit: z.string().max(16).optional().nullable(),
      }),
    )
    .min(1)
    .max(50),
})

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/medicoes/lote`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_measurements',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = batchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const { measurements } = await recordMeasurementsBatch(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      measuredAt: parsed.data.measured_at,
      notes: parsed.data.notes ?? null,
      entries: parsed.data.entries.map((e) => ({
        metricType: e.metric_type,
        value: e.value,
        unit: e.unit ?? null,
      })),
      actorUserId: session.userId,
    })
    return NextResponse.json({ measurements }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
