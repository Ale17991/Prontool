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
import { getRecall, listRecalls } from '@/lib/core/nutrition/recall/plan'
import { listDRIsForPatient, type DriSex, type DriState } from '@/lib/core/nutrition/dri/read'
import { computeAdequacy } from '@/lib/core/nutrition/adequacy'
import type { Nutrients } from '@/lib/core/nutrition/diet/totals'
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
    const url = new URL(req.url)
    const source = url.searchParams.get('source') === 'recordatorio' ? 'recordatorio' : 'plano'

    // Módulo exigido conforme a fonte.
    const requiredModule = source === 'recordatorio' ? 'nutri_recordatorio' : 'dieta'
    if (!ent.hasModule(requiredModule)) {
      return NextResponse.json({ error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } }, { status: 404 })
    }

    // Totais: plano ativo ou recordatório (ref_id, ou o mais recente).
    let totals: Nutrients
    if (source === 'recordatorio') {
      const refId = url.searchParams.get('ref_id')
      const recall = refId
        ? await getRecall(supabase, session.tenantId, refId)
        : (await listRecalls(supabase, session.tenantId, params.id)).latest
      if (!recall) {
        return NextResponse.json({ error: { code: 'NO_RECALL', message: 'Sem recordatório para analisar.' } }, { status: 404 })
      }
      totals = recall.totals
    } else {
      const plan = await getDietPlanForPatient(supabase, session.tenantId, params.id)
      if (!plan) {
        return NextResponse.json({ error: { code: 'NO_PLAN', message: 'Sem plano ativo para analisar.' } }, { status: 404 })
      }
      totals = plan.totals
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
        { totals, adequacy: null, need: { age: ageYears === null, sex: !sexParam } },
        { status: 200 },
      )
    }

    const dris = await listDRIsForPatient(supabase, { ageYears, sex: sexParam, state })
    const adequacy = computeAdequacy(totals, dris)
    return NextResponse.json(
      { totals, patient: { ageYears, sex: sexParam, state }, adequacy },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
