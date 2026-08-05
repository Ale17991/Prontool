/**
 * Feature 054 US4 — GET /api/pacientes/[id]/recordatorio/pdf
 *
 * `?data=YYYY-MM-DD` escolhe o dia; sem ela, o recordatório mais recente. A
 * adequação de micronutrientes entra quando o cadastro tem idade e sexo — sem
 * eles não há DRI aplicável, e inventar uma referência seria pior que omitir o
 * quadro.
 */
import { NextResponse } from 'next/server'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { computeAdequacy, type AdequacyResult } from '@/lib/core/nutrition/adequacy'
import { listDRIsForPatient, type DriSex } from '@/lib/core/nutrition/dri/read'
import { findRecallId, getRecall } from '@/lib/core/nutrition/recall/plan'
import { renderRecallPdf } from '@/lib/core/nutrition/printouts/recall-pdf'
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
  const route = `/api/pacientes/${params.id}/recordatorio/pdf`
  try {
    const ctx = await openPrintout({
      req,
      patientId: params.id,
      route,
      module: 'nutri_recordatorio',
      entity: 'food_recalls',
    })

    const raw = new URL(req.url).searchParams.get('data')
    const recallDate = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null

    const recallId = await findRecallId(ctx.supabase, {
      tenantId: ctx.tenantId,
      patientId: params.id,
      recallDate,
    })
    const recall = recallId ? await getRecall(ctx.supabase, ctx.tenantId, recallId) : null
    if (!recall) {
      return NextResponse.json(
        {
          error: {
            code: 'NO_RECALL',
            message: recallDate
              ? 'Não há recordatório para essa data.'
              : 'Este paciente ainda não tem recordatório.',
          },
        },
        { status: 404 },
      )
    }

    // Idade na DATA DO RECORDATÓRIO, não hoje: a DRI de uma criança muda de
    // faixa com o aniversário, e o consumo é o daquele dia.
    const ageYears = ageAt(ctx.patient.birthDate, recall.recallDate)
    const sex: DriSex | null =
      ctx.patient.sex === 'masculino' ? 'M' : ctx.patient.sex === 'feminino' ? 'F' : null

    let adequacy: AdequacyResult | null = null
    if (ageYears !== null && sex) {
      const dris = await listDRIsForPatient(ctx.supabase, { ageYears, sex, state: 'padrao' })
      adequacy = computeAdequacy(recall.totals, dris)
    }

    const hoje = todayInClinicTz()
    const clinicProfile = await getClinicProfile(
      ctx.supabase,
      ctx.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderRecallPdf({
      clinicProfile,
      patient: {
        name: ctx.patient.fullName || 'Paciente',
        birthDate: ctx.patient.birthDate,
        ageYears,
        sex: ctx.patient.sex,
      },
      professionalName: ctx.userName,
      issuedAt: hoje,
      recall,
      adequacy,
    })

    await auditPrintout(ctx, 'recordatorio')

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: pdfHeaders(
        printoutFilename('recordatorio', ctx.patient.fullName || '', recall.recallDate),
      ),
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
