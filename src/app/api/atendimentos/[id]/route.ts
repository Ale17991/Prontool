import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T087 — GET /api/atendimentos/{id}.
 *
 * Returns the `appointments_effective` row plus its audit trail (the
 * chronological list of `audit_log` entries tied to this appointment).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'appointments',
        entityId: params.id,
        route: `/api/atendimentos/${params.id}`,
        request: req,
      },
    )

    const supabase = createSupabaseServiceClient()
    const appointment = await supabase
      .from('appointments_effective')
      .select('*')
      .eq('id', params.id)
      .eq('tenant_id', session.tenantId)
      .maybeSingle()
    if (appointment.error) throw new Error(`appointment read failed: ${appointment.error.message}`)
    if (!appointment.data) throw new NotFoundError('appointment', params.id)

    const audit = await supabase
      .from('audit_log')
      .select('*')
      .eq('tenant_id', session.tenantId)
      .eq('entity', 'appointments')
      .eq('entity_id', params.id)
      .order('timestamp_utc', { ascending: true })
    if (audit.error) throw new Error(`audit history read failed: ${audit.error.message}`)

    return NextResponse.json(
      { appointment: appointment.data, audit: audit.data ?? [] },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/atendimentos/${params.id}` })
  }
}
