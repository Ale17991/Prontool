import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getExamRequest } from '@/lib/core/exam-requests/crud'
import { renderExamRequestPdf } from '@/lib/core/exam-requests/pdf'
import { getPatient } from '@/lib/core/patients/get'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string; reqId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/solicitacoes-exame/${params.reqId}/pdf`
  try {
    const session = await requireRole(
      ['admin', 'profissional_saude', 'recepcionista'],
      { entity: 'exam_requests', entityId: params.reqId, route, request: req },
    )
    const supabase = createSupabaseServiceClient()

    const reqDoc = await getExamRequest(supabase, {
      tenantId: session.tenantId,
      id: params.reqId,
    })
    if (!reqDoc) throw new NotFoundError('exam_request', params.reqId)

    const [{ patient }, clinicProfile] = await Promise.all([
      getPatient(supabase, { tenantId: session.tenantId, patientId: params.id }),
      getClinicProfile(supabase, session.tenantId, CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS).catch(
        () => null,
      ),
    ])

    const buf = await renderExamRequestPdf(reqDoc, {
      patientName: patient.fullName || '—',
      clinicProfile,
      signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
    })

    // Backlog 1/4/2 — marca como emitido na primeira vez que é baixado p/ envio.
    if (!reqDoc.issuedAt) {
      await supabase
        .from('exam_requests' as never)
        .update({ issued_at: new Date().toISOString() } as never)
        .eq('tenant_id', session.tenantId)
        .eq('id', params.reqId)
        .is('issued_at', null)
    }

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="solicitacao-exame-${params.reqId}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
