/**
 * Feature 054 US4 — GET /api/pacientes/[id]/exames/pdf
 *
 * O quadro de exames laboratoriais. Aceita os mesmos `?age=`/`?sex=`/`?state=`
 * da tela: se a profissional ajustou o sexo ali para destravar as faixas que
 * dependem dele, o papel precisa sair com a mesma classificação que ela está
 * vendo — senão o impresso contradiz a tela de onde saiu.
 */
import { NextResponse } from 'next/server'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { buildLabPanelForPatient, labOverridesFromUrl } from '@/lib/core/labs/panel-for-patient'
import { renderLabsPdf } from '@/lib/core/nutrition/printouts/labs-pdf'
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

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/exames/pdf`
  try {
    const ctx = await openPrintout({
      req,
      patientId: params.id,
      route,
      module: 'exames_lab',
      entity: 'patient_measurements',
    })

    const { panel, need } = await buildLabPanelForPatient(ctx.supabase, {
      tenantId: ctx.tenantId,
      patientId: params.id,
      overrides: labOverridesFromUrl(new URL(req.url)),
    })

    if (panel.items.length === 0) {
      return NextResponse.json(
        { error: { code: 'NO_LABS', message: 'Este paciente ainda não tem exames lançados.' } },
        { status: 404 },
      )
    }

    const hoje = todayInClinicTz()
    const clinicProfile = await getClinicProfile(
      ctx.supabase,
      ctx.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderLabsPdf({
      clinicProfile,
      patient: {
        name: ctx.patient.fullName || 'Paciente',
        birthDate: ctx.patient.birthDate,
        ageYears: ageAt(ctx.patient.birthDate, hoje),
        sex: ctx.patient.sex,
      },
      professionalName: ctx.userName,
      issuedAt: hoje,
      items: panel.items,
      blockedBySex: need.blockedBySex,
    })

    await auditPrintout(ctx, 'exames')

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: pdfHeaders(printoutFilename('exames', ctx.patient.fullName || '', hoje)),
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
