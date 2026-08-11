import { getEyeglassRx } from '@/lib/core/eyeglass-prescriptions/crud'
import { renderEyeglassRxPdf } from '@/lib/core/eyeglass-prescriptions/pdf'
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
  { params }: { params: { id: string; rxId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/receitas-oculos/${params.rxId}/pdf`
  try {
    const ctx = await openPrintout({
      req,
      patientId: params.id,
      route,
      entity: 'eyeglass_prescriptions',
      entityId: params.rxId,
      document: 'receita-oculos',
      roles: ['admin', 'profissional_saude', 'recepcionista'],
    })
    const supabase = ctx.supabase
    const rx = await getEyeglassRx(supabase, { tenantId: ctx.tenantId, id: params.rxId })
    if (!rx) throw new NotFoundError('eyeglass_prescription', params.rxId)

    const clinicProfile = await getClinicProfile(
      supabase,
      ctx.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderEyeglassRxPdf(rx, {
      identity: ctx.identity,
      clinicProfile,
      signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
    })

    if (!rx.issuedAt) {
      await supabase
        .from('eyeglass_prescriptions' as never)
        .update({ issued_at: new Date().toISOString() } as never)
        .eq('tenant_id', ctx.tenantId)
        .eq('id', params.rxId)
        .is('issued_at', null)
    }

    await auditPrintout(ctx)

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="receita-oculos-${params.rxId}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
