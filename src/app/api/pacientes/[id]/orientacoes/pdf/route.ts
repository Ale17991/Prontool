/**
 * Feature 054 US3 — GET /api/pacientes/[id]/orientacoes/pdf
 *
 * Sem gate de módulo: orientação ao paciente é da ficha clínica (032), não da
 * vertical de nutrição. Exigir `dieta` aqui esconderia de quem não comprou o
 * plano alimentar um texto que ele já escreve hoje na tela.
 */
import { NextResponse } from 'next/server'
import { getClinicProfile } from '@/lib/core/clinic-profile/read'
import { CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS } from '@/lib/core/clinic-profile/types'
import { renderCareNotesPdf } from '@/lib/core/care-notes/notes-pdf'
import { listCareNotes } from '@/lib/core/patient-portal/care-notes'
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
  const route = `/api/pacientes/${params.id}/orientacoes/pdf`
  try {
    const ctx = await openPrintout({
      document: 'orientacoes',
      req,
      patientId: params.id,
      route,
      entity: 'patient_care_notes',
    })

    const notes = await listCareNotes(ctx.supabase, ctx.tenantId, params.id)
    if (notes.length === 0) {
      return NextResponse.json(
        { error: { code: 'NO_NOTES', message: 'Este paciente ainda não tem orientações.' } },
        { status: 404 },
      )
    }

    const hoje = todayInClinicTz()
    const clinicProfile = await getClinicProfile(
      ctx.supabase,
      ctx.tenantId,
      CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS,
    ).catch(() => null)

    const buf = await renderCareNotesPdf({
      clinicProfile,
      identity: ctx.identity,
      professionalName: ctx.userName,
      issuedAt: hoje,
      notes,
    })

    await auditPrintout(ctx)

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: pdfHeaders(printoutFilename('orientacoes', ctx.patient.fullName || '', hoje)),
    })
  } catch (err) {
    if (err instanceof PrintoutDenied) return deniedResponse(err)
    return toHttpResponse(err, { route })
  }
}
