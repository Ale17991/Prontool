import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { assemblePatientChart } from '@/lib/core/patient-medical/assemble-prontuario'
import { renderProntuarioPdf } from '@/lib/core/patient-medical/prontuario-pdf'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO AAAA-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO AAAA-MM-DD')
    .optional(),
  /** Backlog 1/7 — quando presente, abre inline (pré-visualização) em vez de baixar. */
  inline: z.string().optional(),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/prontuario/pdf`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'profissional_saude'],
      { entity: 'patients', entityId: params.id, route, request: req },
    )
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'from/to inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const bundle = await assemblePatientChart(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      from: parsed.data.from,
      to: parsed.data.to,
    })
    const buf = await renderProntuarioPdf(bundle)

    const slug = (bundle.patient.fullName || 'paciente')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40)
    const stamp = new Date().toISOString().slice(0, 10)
    const filename = `prontuario-${slug}-${stamp}.pdf`

    const disposition = parsed.data.inline ? 'inline' : 'attachment'
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `${disposition}; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
