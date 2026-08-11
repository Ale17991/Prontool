/**
 * Feature 054 US3 — GET /api/pacientes/[id]/anamnese/[recordId]/pdf
 *
 * A anamnese preenchida, para arquivo ou encaminhamento. Uma anamnese por vez:
 * ela é o retrato de uma data, e empilhar várias num documento só sugeriria
 * continuidade entre respostas que foram dadas em contextos diferentes.
 *
 * Sem gate de módulo — anamnese é da ficha clínica, não da vertical de nutrição.
 */
import { NextResponse } from 'next/server'
import { renderAnamnesisPdf } from '@/lib/core/anamnesis/export-pdf'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { getClinicalRecord } from '@/lib/core/clinical-records/list'
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

export async function GET(
  req: Request,
  { params }: { params: { id: string; recordId: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/anamnese/${params.recordId}/pdf`
  try {
    const ctx = await openPrintout({
      document: 'anamnese',
      req,
      patientId: params.id,
      route,
      entity: 'clinical_records',
    })

    const record = await getClinicalRecord(ctx.supabase, {
      tenantId: ctx.tenantId,
      patientId: params.id,
      recordId: params.recordId,
    })
    // Registro de outro tipo (texto, arquivo, evolução) cai no mesmo 404 do
    // inexistente: não há anamnese para imprimir, e distinguir os casos só
    // informaria que o id existe.
    if (!record || record.type !== 'anamnese' || !record.anamnesisData) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Anamnese não encontrada.' } },
        { status: 404 },
      )
    }

    const snapshot = record.anamnesisData
    const hoje = todayInClinicTz()
    const clinicProfile = await getClinicProfile(
      ctx.supabase,
      ctx.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderAnamnesisPdf({
      clinicProfile,
      identity: ctx.identity,
      templateTitle: snapshot.template_title,
      templateVersion: snapshot.template_version,
      fields: snapshot.fields ?? [],
      responses: snapshot.responses ?? {},
      createdAt: record.createdAt,
      issuedAt: hoje,
      professionalName: ctx.userName,
    })

    await auditPrintout(ctx)

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: pdfHeaders(printoutFilename('anamnese', ctx.patient.fullName || '', hoje)),
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
