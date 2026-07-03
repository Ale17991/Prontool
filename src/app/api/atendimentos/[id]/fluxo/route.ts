import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  FLOW_STATUSES,
  getAppointmentFlow,
  setAppointmentFlowStatus,
} from '@/lib/core/appointment-flow/crud'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const postSchema = z.object({
  status: z.enum(FLOW_STATUSES as [string, ...string[]]),
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/fluxo`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'appointment_flow', entityId: params.id, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const flow = await getAppointmentFlow(supabase, {
      tenantId: session.tenantId,
      appointmentId: params.id,
    })
    return NextResponse.json({ flow }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/fluxo`
  try {
    const session = await requireRole(['admin', 'recepcionista', 'profissional_saude'], {
      entity: 'appointment_flow',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = postSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues },
        },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const flow = await setAppointmentFlowStatus(supabase, {
      tenantId: session.tenantId,
      appointmentId: params.id,
      status: parsed.data.status as (typeof FLOW_STATUSES)[number],
      actorUserId: session.userId,
    })
    return NextResponse.json({ flow }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
