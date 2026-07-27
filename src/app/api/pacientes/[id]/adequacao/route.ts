/**
 * Feature 049 US2 — GET /api/pacientes/[id]/adequacao (equipe).
 * Análise de adequação do plano ativo (ou recordatório) × DRI do paciente.
 * Gated `dieta`; RBAC admin/profissional_saude.
 */
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { getDietPlanForPatient } from '@/lib/core/nutrition/diet/plan'
import { listDRIsForPatient, type DriSex, type DriState } from '@/lib/core/nutrition/dri/read'
import { computeAdequacy } from '@/lib/core/nutrition/adequacy'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function ageFromBirth(iso: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let a = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
  return a >= 0 && a < 130 ? a : null
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/adequacao`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'diet_plans',
      entityId: params.id,
      route,
      request: req,
    })
    const supabase = createSupabaseServiceClient()
    const ent = await getTenantEntitlements(supabase, session.tenantId)
    if (!ent.hasModule('dieta')) {
      return NextResponse.json({ error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } }, { status: 404 })
    }

    const url = new URL(req.url)
    // Totais: por ora, do plano ativo (source=plano). Recordatório entra na US3.
    const plan = await getDietPlanForPatient(supabase, session.tenantId, params.id)
    if (!plan) {
      return NextResponse.json({ error: { code: 'NO_PLAN', message: 'Sem plano ativo para analisar.' } }, { status: 404 })
    }

    // Idade/sexo/estado: query params sobrescrevem; senão, do cadastro.
    let ageYears = url.searchParams.get('age') ? Number(url.searchParams.get('age')) : null
    let sexParam = url.searchParams.get('sex') as DriSex | null
    const state = (url.searchParams.get('state') as DriState | null) ?? 'padrao'

    if (ageYears === null || !sexParam) {
      const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
      const { data } = await supabase.rpc('get_patient_for_tenant', {
        p_tenant_id: session.tenantId,
        p_patient_id: params.id,
        p_key: key,
      } as never)
      const p = ((data as unknown as Array<{ birth_date: string | null; sex: string | null }>) ?? [])[0]
      if (p) {
        if (ageYears === null && p.birth_date) ageYears = ageFromBirth(p.birth_date)
        if (!sexParam && p.sex) sexParam = p.sex === 'masculino' ? 'M' : p.sex === 'feminino' ? 'F' : null
      }
    }

    if (ageYears === null || !sexParam) {
      return NextResponse.json(
        { plan: { totals: plan.totals }, adequacy: null, need: { age: ageYears === null, sex: !sexParam } },
        { status: 200 },
      )
    }

    const dris = await listDRIsForPatient(supabase, { ageYears, sex: sexParam, state })
    const adequacy = computeAdequacy(plan.totals, dris)
    return NextResponse.json(
      { totals: plan.totals, patient: { ageYears, sex: sexParam, state }, adequacy },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
