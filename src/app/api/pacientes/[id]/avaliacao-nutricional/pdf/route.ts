/**
 * Feature 054 US2 — GET /api/pacientes/[id]/avaliacao-nutricional/pdf
 *
 * Evolução da composição corporal, até três avaliações lado a lado.
 */
import { NextResponse } from 'next/server'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { listAssessmentsForPrintout } from '@/lib/core/nutrition/assessments/for-printout'
import { renderAssessmentPdf } from '@/lib/core/nutrition/printouts/assessment-pdf'
import {
  auditPrintout,
  deniedResponse,
  openPrintout,
  pdfHeaders,
  printoutFilename,
  PrintoutDenied,
} from '@/lib/core/printouts/guard'
import { ageAt, todayInClinicTz } from '@/lib/core/nutrition/printouts/shared'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/avaliacao-nutricional/pdf`
  try {
    const ctx = await openPrintout({
      document: 'avaliacao-nutricional',
      req,
      patientId: params.id,
      route,
      module: 'nutri_avaliacao',
      entity: 'nutrition_assessments',
    })

    // Três é o padrão e o teto (research D7): é o que a planilha usa e o que
    // cabe legível em A4 retrato.
    const raw = Number(new URL(req.url).searchParams.get('limite') ?? '3')
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 3) : 3

    const assessments = await listAssessmentsForPrintout(ctx.supabase, {
      tenantId: ctx.tenantId,
      patientId: params.id,
      limit,
    })
    if (assessments.length === 0) {
      return NextResponse.json(
        { error: { code: 'NO_ASSESSMENT', message: 'Este paciente ainda não tem avaliação.' } },
        { status: 404 },
      )
    }

    const hoje = todayInClinicTz()
    const clinicProfile = await getClinicProfile(
      ctx.supabase,
      ctx.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderAssessmentPdf({
      clinicProfile,
      identity: ctx.identity,
      professionalName: ctx.userName,
      issuedAt: hoje,
      assessments,
    })

    await auditPrintout(ctx)

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: pdfHeaders(printoutFilename('avaliacao', ctx.patient.fullName || '', hoje)),
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
