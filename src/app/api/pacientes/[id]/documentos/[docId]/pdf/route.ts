import { getPatientDocument } from '@/lib/core/patient-documents/list'
import { renderPatientDocumentPdf } from '@/lib/core/patient-documents/pdf'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'
import {
  auditPrintout,
  deniedResponse,
  openPrintout,
  PrintoutDenied,
} from '@/lib/core/printouts/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string; docId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/documentos/${params.docId}/pdf`
  try {
    const ctx = await openPrintout({
      req,
      patientId: params.id,
      route,
      entity: 'patient_documents',
      entityId: params.docId,
      document: 'documento',
      roles: ['admin', 'profissional_saude', 'recepcionista'],
    })
    const supabase = ctx.supabase

    const doc = await getPatientDocument(supabase, {
      tenantId: ctx.tenantId,
      documentId: params.docId,
    })
    if (!doc) throw new NotFoundError('patient_document', params.docId)

    const clinicProfile = await getClinicProfile(
      supabase,
      ctx.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderPatientDocumentPdf(doc, {
      identity: ctx.identity,
      clinicProfile,
      signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
    })

    // Backlog 1/4/2 — marca como emitido na primeira vez que é baixado p/ envio.
    if (!doc.issuedAt) {
      await supabase
        .from('patient_documents' as never)
        .update({ issued_at: new Date().toISOString() } as never)
        .eq('tenant_id', ctx.tenantId)
        .eq('id', params.docId)
        .is('issued_at', null)
    }

    await auditPrintout(ctx)

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="documento-${params.docId}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
