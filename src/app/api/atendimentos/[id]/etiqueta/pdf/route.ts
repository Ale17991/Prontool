import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listScans } from '@/lib/core/surgical-scans/scan-service'
import { generateVerificationToken } from '@/lib/core/surgical-scans/verification-service'
import { renderSurgicalLabelPdf } from '@/lib/core/surgical-scans/label-pdf'
import { getPatient } from '@/lib/core/patients/get'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function resolveBaseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL
  if (env) return env.replace(/\/$/, '')
  try {
    return new URL(req.url).origin
  } catch {
    return ''
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/atendimentos/${params.id}/etiqueta/pdf`
  try {
    const session = await requireRole(['admin', 'profissional_saude', 'recepcionista'], {
      entity: 'surgical_material_scans',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()

    const { data: appt } = await supabase
      .from('appointments')
      .select('patient_id, appointment_at')
      .eq('tenant_id', session.tenantId)
      .eq('id', params.id)
      .maybeSingle()
    if (!appt) throw new NotFoundError('appointment', params.id)

    const [scans, token, { patient }, clinicProfile] = await Promise.all([
      listScans(supabase, session.tenantId, params.id),
      generateVerificationToken(supabase, session.tenantId, params.id),
      getPatient(supabase, { tenantId: session.tenantId, patientId: appt.patient_id }),
      getClinicProfile(supabase, session.tenantId, CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS).catch(
        () => null,
      ),
    ])

    const verificationUrl = `${resolveBaseUrl(req)}/verificar/${token}`
    const buf = await renderSurgicalLabelPdf({
      patientName: patient.fullName || '—',
      appointmentDate: appt.appointment_at,
      scans,
      verificationUrl,
      clinicProfile,
      signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
    })

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="etiqueta-${params.id}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
