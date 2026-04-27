import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  createHistory,
  listHistory,
  type HistoryCategory,
} from '@/lib/core/patient-medical/history'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  category: z.enum([
    'doenca_pregressa',
    'cirurgia',
    'medicamento_uso_continuo',
    'antecedente_familiar',
    'habito',
    'outro',
  ]),
  description: z.string().trim().min(1).max(1000),
  date_reported: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO AAAA-MM-DD')
    .optional()
    .nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/antecedentes`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'patient_history', entityId: params.id, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const items = await listHistory(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json(items, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/antecedentes`
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'patient_history',
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
    const result = await createHistory(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      category: parsed.data.category as HistoryCategory,
      description: parsed.data.description,
      dateReported: parsed.data.date_reported ?? null,
      notes: parsed.data.notes ?? null,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
