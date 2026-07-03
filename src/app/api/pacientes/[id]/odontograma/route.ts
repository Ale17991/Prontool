import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listCurrentChart } from '@/lib/core/dental/chart/list-current'
import { createChartEntry } from '@/lib/core/dental/chart/create-entry'
import {
  listActiveStatuses,
  listStatusesByIds,
  type DentalStatusDTO,
} from '@/lib/core/dental/status-catalog/list'
import { SURFACES } from '@/lib/core/dental/teeth'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  tooth_fdi: z.number().int(),
  surface: z.enum(SURFACES).optional().nullable(),
  status_id: z.string().uuid(),
  note: z.string().max(2000).optional().nullable(),
  appointment_id: z.string().uuid().optional().nullable(),
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/odontograma`
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'dental_chart_entries',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()

    const [current, active] = await Promise.all([
      listCurrentChart(supabase, { tenantId: session.tenantId, patientId: params.id }),
      listActiveStatuses(supabase),
    ])

    // FR-013: estado atual pode referenciar status já desativados — busca seus
    // metadados para que o cliente renderize cor/rótulo mesmo fora da paleta.
    const activeIds = new Set(active.map((s) => s.id))
    const missingIds = [
      ...new Set(current.map((c) => c.statusId).filter((id) => !activeIds.has(id))),
    ]
    const referenced = await listStatusesByIds(supabase, missingIds)
    const statuses: DentalStatusDTO[] = [...active, ...referenced]

    return NextResponse.json({ patientId: params.id, current, statuses }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/odontograma`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'dental_chart_entries',
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
    const result = await createChartEntry(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      toothFdi: parsed.data.tooth_fdi,
      surface: parsed.data.surface ?? null,
      statusId: parsed.data.status_id,
      note: parsed.data.note ?? null,
      appointmentId: parsed.data.appointment_id ?? null,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
