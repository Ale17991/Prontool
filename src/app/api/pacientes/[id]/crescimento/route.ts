/**
 * Curvas de crescimento infantil — GET /api/pacientes/[id]/crescimento.
 *
 * Só leitura: as medições já são gravadas como sinais vitais na consulta. Gated
 * por `nutri_avaliacao` (mesmo módulo da antropometria) — não abri módulo novo
 * porque isto é a antropometria da criança, não outra capacidade de venda.
 */
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { getPatient } from '@/lib/core/patients/get'
import { buildGrowthReport } from '@/lib/core/growth/read'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.CLINIC_TIMEZONE || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/crescimento`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'growth_percentiles',
      entityId: params.id,
      route,
      request: req,
    })

    const supabase = createSupabaseServiceClient()
    const ent = await getTenantEntitlements(supabase, session.tenantId)
    if (!ent.hasModule('nutri_avaliacao')) {
      return NextResponse.json(
        { error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } },
        { status: 404 },
      )
    }

    const { patient } = await getPatient(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })

    const report = await buildGrowthReport(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      birthDate: patient.birthDate,
      sex: patient.sex,
      today: today(),
    })
    return NextResponse.json(report, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
