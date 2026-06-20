import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getEyeglassRx } from '@/lib/core/eyeglass-prescriptions/crud'
import { renderEyeglassRxPdf } from '@/lib/core/eyeglass-prescriptions/pdf'
import { getPatient } from '@/lib/core/patients/get'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string; rxId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/receitas-oculos/${params.rxId}/pdf`
  try {
    const session = await requireRole(['admin', 'profissional_saude', 'recepcionista'], {
      entity: 'eyeglass_prescriptions',
      entityId: params.rxId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const rx = await getEyeglassRx(supabase, { tenantId: session.tenantId, id: params.rxId })
    if (!rx) throw new NotFoundError('eyeglass_prescription', params.rxId)

    const [{ patient }, clinicProfile] = await Promise.all([
      getPatient(supabase, { tenantId: session.tenantId, patientId: params.id }),
      getClinicProfile(supabase, session.tenantId, CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS).catch(() => null),
    ])

    const buf = await renderEyeglassRxPdf(rx, {
      patientName: patient.fullName || '—',
      clinicProfile,
      signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
    })

    if (!rx.issuedAt) {
      await supabase
        .from('eyeglass_prescriptions' as never)
        .update({ issued_at: new Date().toISOString() } as never)
        .eq('tenant_id', session.tenantId)
        .eq('id', params.rxId)
        .is('issued_at', null)
    }

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="receita-oculos-${params.rxId}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
