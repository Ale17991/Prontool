/**
 * Curvas de crescimento infantil — GET /api/pacientes/[id]/crescimento.
 *
 * Só leitura: as medições já são gravadas como sinais vitais na consulta. Gated
 * por `nutri_avaliacao` (mesmo módulo da antropometria) — não abri módulo novo
 * porque isto é a antropometria da criança, não outra capacidade de venda.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
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

    // O acompanhamento é uma DECISÃO da profissional, não uma dedução de "tem
    // dado suficiente": numa clínica de adultos a curva apareceria em qualquer
    // paciente jovem com peso registrado.
    const enabled = await isGrowthTrackingEnabled(supabase, session.tenantId, params.id)
    if (!enabled) {
      return NextResponse.json(
        {
          enabled: false,
          curves: [],
          ageMonthsNow: null,
          missing: { birthDate: false, sex: false },
          outOfRange: false,
        },
        { status: 200 },
      )
    }

    const report = await buildGrowthReport(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      birthDate: patient.birthDate,
      sex: patient.sex,
      today: today(),
    })
    return NextResponse.json({ enabled: true, ...report }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

async function isGrowthTrackingEnabled(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  patientId: string,
): Promise<boolean> {
  const res = await (supabase as unknown as ReturnType<typeof createSupabaseServiceClient>)
    .from('patients')
    .select('growth_tracking_enabled')
    .eq('tenant_id', tenantId)
    .eq('id', patientId)
    .maybeSingle()
  return Boolean(
    (res.data as { growth_tracking_enabled?: boolean } | null)?.growth_tracking_enabled,
  )
}

const toggleSchema = z.object({ enabled: z.boolean() })

/** Liga/desliga o acompanhamento de crescimento deste paciente. */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/crescimento`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patients',
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

    const parsed = toggleSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido.' } },
        { status: 400 },
      )
    }

    const upd = await (supabase as never as ReturnType<typeof createSupabaseServiceClient>)
      .from('patients')
      .update({ growth_tracking_enabled: parsed.data.enabled } as never)
      .eq('tenant_id', session.tenantId)
      .eq('id', params.id)
    if (upd.error) throw new Error(`toggle growth: ${upd.error.message}`)

    return NextResponse.json({ enabled: parsed.data.enabled }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
