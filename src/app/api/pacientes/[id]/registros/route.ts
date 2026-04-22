import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listClinicalRecords } from '@/lib/core/clinical-records/list'
import { createTextClinicalRecord } from '@/lib/core/clinical-records/create'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET  /api/pacientes/{id}/registros  — lista registros (todos os papéis)
 * POST /api/pacientes/{id}/registros  — cria registro tipo `texto`
 *                                       (admin / financeiro / profissional_saude).
 *                                       Profissionais da saúde precisam registrar
 *                                       evolução clínica; admin/financeiro registram
 *                                       atendimentos administrativos.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'clinical_records',
        entityId: params.id,
        route: `/api/pacientes/${params.id}/registros`,
        request: req,
      },
    )
    const supabase = createSupabaseServiceClient()
    const records = await listClinicalRecords(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json(records, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/pacientes/${params.id}/registros` })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro', 'profissional_saude'], {
      entity: 'clinical_records',
      entityId: params.id,
      route: `/api/pacientes/${params.id}/registros`,
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'title e content são obrigatórios' },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const created = await createTextClinicalRecord(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      title: parsed.data.title,
      content: parsed.data.content,
      actorUserId: session.userId,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/pacientes/${params.id}/registros` })
  }
}
