import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { addParticipant } from '@/lib/core/appointment-assistants/add-participant'
import { listParticipantsByProcedure } from '@/lib/core/appointment-assistants/list-participants-by-procedure'
import { listParticipationDegrees } from '@/lib/core/tiss/domains'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/atendimentos/{id}/participantes — adiciona uma participação
 * (equipe) a uma linha de procedimento do atendimento (feature 031).
 * RBAC: admin/financeiro (valor financeiro). Negação logada por requireRole.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const postBodySchema = z.object({
  procedureId: z.string().uuid(),
  doctorId: z.string().uuid(),
  participationDegree: z.string().min(1).max(8),
  amountCents: z.number().int().positive().max(100_000_00),
})

/**
 * GET — lista participantes ativos (agrupáveis por procedimento) + o catálogo
 * necessário ao seletor (médicos ativos + graus do domínio 35). Honorários são
 * mascarados (null) para quem não tem `finance.view_values`.
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/participantes`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'appointment_assistants', entityId: params.id, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const canViewValues = can(session.role, 'finance.view_values')
    const [participants, degrees, doctorsRes] = await Promise.all([
      listParticipantsByProcedure(supabase, {
        tenantId: session.tenantId,
        appointmentId: params.id,
      }),
      listParticipationDegrees(supabase),
      supabase
        .from('doctors')
        .select('id, full_name')
        .eq('tenant_id', session.tenantId)
        .eq('active', true)
        .order('full_name', { ascending: true }),
    ])
    if (doctorsRes.error) throw new Error(`load doctors: ${doctorsRes.error.message}`)
    return NextResponse.json(
      {
        participants: participants.map((p) => ({
          participantId: p.participantId,
          procedureId: p.procedureId,
          doctorId: p.doctorId,
          doctorName: p.doctorName,
          participationDegree: p.participationDegree,
          degreeLabel: p.degreeLabel,
          amountCents: canViewValues ? p.amountCents : null,
        })),
        doctors: (doctorsRes.data ?? []).map((d) => ({
          id: d.id as string,
          fullName: (d as { full_name: string }).full_name,
        })),
        degrees: degrees.map((d) => ({ code: d.code, label: d.description })),
        canViewValues,
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/participantes`
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'appointment_assistants',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = postBodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await addParticipant(supabase, {
      tenantId: session.tenantId,
      appointmentId: params.id,
      procedureId: parsed.data.procedureId,
      doctorId: parsed.data.doctorId,
      participationDegree: parsed.data.participationDegree,
      amountCents: parsed.data.amountCents,
      actorUserId: session.userId,
    })
    return NextResponse.json({ participantId: result.id }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
