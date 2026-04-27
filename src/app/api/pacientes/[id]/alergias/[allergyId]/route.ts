import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { softDeleteAllergy } from '@/lib/core/patient-medical/allergies'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; allergyId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/alergias/${params.allergyId}`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_allergies',
      entityId: params.allergyId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    await softDeleteAllergy(supabase, {
      tenantId: session.tenantId,
      allergyId: params.allergyId,
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
