/**
 * Feature 054 US1 — GET /api/pacientes/[id]/plano-alimentar/pdf
 *
 * O plano alimentar em papel. Só leitura: o documento é recomposto a cada
 * emissão, nunca arquivado — assim uma correção no plano aparece na próxima
 * impressão em vez de ficar presa num PDF velho.
 */
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { getDietPlanForPatient } from '@/lib/core/nutrition/diet/plan'
import { renderPlanPdf } from '@/lib/core/nutrition/printouts/plan-pdf'
import {
  auditPrintout,
  deniedResponse,
  openPrintout,
  pdfHeaders,
  printoutFilename,
  PrintoutDenied,
} from '@/lib/core/nutrition/printouts/guard'
import { ageAt, todayInClinicTz } from '@/lib/core/nutrition/printouts/shared'
import { NextResponse } from 'next/server'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
// O renderer de PDF não roda em edge.
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/plano-alimentar/pdf`
  try {
    const ctx = await openPrintout({
      req,
      patientId: params.id,
      route,
      module: 'dieta',
      entity: 'diet_plans',
    })

    const plan = await getDietPlanForPatient(ctx.supabase, ctx.tenantId, params.id)
    if (!plan) {
      return NextResponse.json(
        { error: { code: 'NO_PLAN', message: 'Este paciente ainda não tem plano alimentar.' } },
        { status: 404 },
      )
    }

    const hoje = todayInClinicTz()
    const clinicProfile = await getClinicProfile(
      ctx.supabase,
      ctx.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderPlanPdf({
      clinicProfile,
      patient: {
        name: ctx.patient.fullName || 'Paciente',
        birthDate: ctx.patient.birthDate,
        ageYears: ageAt(ctx.patient.birthDate, hoje),
        sex: ctx.patient.sex,
      },
      professionalName: ctx.userName,
      issuedAt: hoje,
      plan,
    })

    await auditPrintout(ctx, 'plano-alimentar')

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: pdfHeaders(printoutFilename('plano-alimentar', ctx.patient.fullName || '', hoje)),
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
