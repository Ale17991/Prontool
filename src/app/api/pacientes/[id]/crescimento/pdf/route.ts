/**
 * Feature 054 US5 — GET /api/pacientes/[id]/crescimento/pdf
 *
 * Curvas de crescimento com o percurso da criança. Módulo `nutri_avaliacao`: a
 * curva é a antropometria da criança, não uma capacidade de venda separada —
 * mesma decisão da rota de leitura.
 */
import { NextResponse } from 'next/server'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { buildGrowthReport } from '@/lib/core/growth/read'
import { renderGrowthPdf } from '@/lib/core/nutrition/printouts/growth-pdf'
import {
  auditPrintout,
  deniedResponse,
  openPrintout,
  pdfHeaders,
  printoutFilename,
  PrintoutDenied,
} from '@/lib/core/nutrition/printouts/guard'
import { ageAt, todayInClinicTz } from '@/lib/core/nutrition/printouts/shared'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function fail(code: string, message: string): Response {
  return NextResponse.json({ error: { code, message } }, { status: 404 })
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/crescimento/pdf`
  try {
    const ctx = await openPrintout({
      req,
      patientId: params.id,
      route,
      module: 'nutri_avaliacao',
      entity: 'growth_percentiles',
    })

    // O acompanhamento é uma DECISÃO da profissional, não uma dedução de "tem
    // dado suficiente" — sem ela ligada não há documento a emitir.
    const flag = await ctx.supabase
      .from('patients')
      .select('growth_tracking_enabled')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', params.id)
      .maybeSingle()
    if (!(flag.data as { growth_tracking_enabled?: boolean } | null)?.growth_tracking_enabled) {
      return fail('GROWTH_DISABLED', 'O acompanhamento de crescimento não está ligado para este paciente.')
    }

    const hoje = todayInClinicTz()
    const report = await buildGrowthReport(ctx.supabase, {
      tenantId: ctx.tenantId,
      patientId: params.id,
      birthDate: ctx.patient.birthDate,
      sex: ctx.patient.sex,
      today: hoje,
    })

    if (report.missing.birthDate || report.missing.sex) {
      // Sem nascimento ou sexo a curva não é calculável, e desenhar uma curva
      // "aproximada" seria classificar criança por chute.
      return fail(
        'GROWTH_INCOMPLETE',
        'Informe data de nascimento e sexo no cadastro para gerar as curvas.',
      )
    }
    if (report.outOfRange) {
      // Fora de 0–19 anos as curvas pediátricas não se aplicam.
      return fail('GROWTH_OUT_OF_RANGE', 'As curvas de crescimento valem até 19 anos.')
    }
    if (report.curves.every((c) => c.points.length === 0)) {
      return fail('NO_GROWTH_DATA', 'Nenhuma aferição de peso ou estatura registrada.')
    }

    const clinicProfile = await getClinicProfile(
      ctx.supabase,
      ctx.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderGrowthPdf({
      clinicProfile,
      patient: {
        name: ctx.patient.fullName || 'Paciente',
        birthDate: ctx.patient.birthDate,
        ageYears: ageAt(ctx.patient.birthDate, hoje),
        sex: ctx.patient.sex,
      },
      professionalName: ctx.userName,
      issuedAt: hoje,
      // Indicador sem nenhuma aferição não vira gráfico vazio.
      curves: report.curves.filter((c) => c.points.length > 0),
    })

    await auditPrintout(ctx, 'crescimento')

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: pdfHeaders(printoutFilename('crescimento', ctx.patient.fullName || '', hoje)),
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
