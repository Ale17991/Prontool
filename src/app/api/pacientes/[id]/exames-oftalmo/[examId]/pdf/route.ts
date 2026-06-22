import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getOphthalExam } from '@/lib/core/ophthalmology-exams/crud'
import { renderOphthalExamPdf } from '@/lib/core/ophthalmology-exams/pdf'
import { getDefaultExamReportTemplate } from '@/lib/core/exam-report-templates/crud'
import { resolveOphthalReportTemplate } from '@/lib/core/exam-report-templates/apply'
import { getPatient } from '@/lib/core/patients/get'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string; examId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/exames-oftalmo/${params.examId}/pdf`
  try {
    const session = await requireRole(['admin', 'profissional_saude', 'recepcionista'], {
      entity: 'ophthalmology_exams',
      entityId: params.examId,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const ex = await getOphthalExam(supabase, { tenantId: session.tenantId, id: params.examId })
    if (!ex) throw new NotFoundError('ophthalmology_exam', params.examId)

    const [{ patient }, clinicProfile, defaultTemplate] = await Promise.all([
      getPatient(supabase, { tenantId: session.tenantId, patientId: params.id }),
      getClinicProfile(supabase, session.tenantId, CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS).catch(() => null),
      getDefaultExamReportTemplate(supabase, {
        tenantId: session.tenantId,
        examType: 'oftalmologico',
      }).catch(() => null),
    ])

    // Backlog 2/2 — aplica o modelo de laudo padrão, se houver.
    const template = defaultTemplate
      ? (() => {
          const r = resolveOphthalReportTemplate(defaultTemplate, {
            exam: ex,
            patientName: patient.fullName || '—',
            birthDate: patient.birthDate,
            clinicName: clinicProfile?.displayName ?? '',
          })
          return {
            headerText: r.headerText,
            conclusionText: r.conclusionText,
            footerText: r.footerText,
          }
        })()
      : null

    const buf = await renderOphthalExamPdf(ex, {
      patientName: patient.fullName || '—',
      clinicProfile,
      signedLogoUrl: clinicProfile?.logo?.signedUrl ?? null,
      template,
    })

    if (!ex.issuedAt) {
      await supabase
        .from('ophthalmology_exams' as never)
        .update({ issued_at: new Date().toISOString() } as never)
        .eq('tenant_id', session.tenantId)
        .eq('id', params.examId)
        .is('issued_at', null)
    }

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="exame-oftalmo-${params.examId}.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
