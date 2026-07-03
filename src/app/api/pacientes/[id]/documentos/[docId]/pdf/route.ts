import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPatientDocument } from '@/lib/core/patient-documents/list'
import { renderPatientDocumentPdf } from '@/lib/core/patient-documents/pdf'
import { getPatient } from '@/lib/core/patients/get'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string; docId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/documentos/${params.docId}/pdf`
  try {
    const session = await requireRole(['admin', 'profissional_saude', 'recepcionista'], {
      entity: 'patient_documents',
      entityId: params.docId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()

    const doc = await getPatientDocument(supabase, {
      tenantId: session.tenantId,
      documentId: params.docId,
    })
    if (!doc) throw new NotFoundError('patient_document', params.docId)

    const [{ patient }, clinicProfile] = await Promise.all([
      getPatient(supabase, { tenantId: session.tenantId, patientId: params.id }),
      getClinicProfile(supabase, session.tenantId, CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS).catch(
        () => null,
      ),
    ])

    const buf = await renderPatientDocumentPdf(doc, {
      patientName: patient.fullName || '—',
      clinicProfile,
      signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
    })

    // Backlog 1/4/2 — marca como emitido na primeira vez que é baixado p/ envio.
    if (!doc.issuedAt) {
      await supabase
        .from('patient_documents' as never)
        .update({ issued_at: new Date().toISOString() } as never)
        .eq('tenant_id', session.tenantId)
        .eq('id', params.docId)
        .is('issued_at', null)
    }

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="documento-${params.docId}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
