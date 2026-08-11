import { getExamRequest } from '@/lib/core/exam-requests/crud'
import { renderExamRequestPdf } from '@/lib/core/exam-requests/pdf'
import {
  auditPrintout,
  deniedResponse,
  openPrintout,
  PrintoutDenied,
} from '@/lib/core/printouts/guard'
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
    const ctx = await openPrintout({
      req,
      patientId: params.id,
      route,
      entity: 'exam_requests',
      entityId: params.reqId,
      document: 'pedido-exame',
      roles: ['admin', 'profissional_saude', 'recepcionista'],
    })
    const supabase = ctx.supabase

    const reqDoc = await getExamRequest(supabase, {
      tenantId: ctx.tenantId,
      id: params.reqId,
    })
    if (!reqDoc) throw new NotFoundError('exam_request', params.reqId)

    const clinicProfile = await getClinicProfile(
      supabase,
      ctx.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderExamRequestPdf(reqDoc, {
      identity: ctx.identity,
      clinicProfile,
      signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
    })

    // Backlog 1/4/2 — marca como emitido na primeira vez que é baixado p/ envio.
    if (!reqDoc.issuedAt) {
      await supabase
        .from('exam_requests' as never)
        .update({ issued_at: new Date().toISOString() } as never)
        .eq('tenant_id', ctx.tenantId)
        .eq('id', params.reqId)
        .is('issued_at', null)
    }

    await auditPrintout(ctx)

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="solicitacao-exame-${params.reqId}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
