import { redirect } from 'next/navigation'
import { FileText } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import { TissPanel, type GuiaRow, type LoteRow, type PlanGroup } from './tiss-panel'

export const dynamic = 'force-dynamic'

interface GuiaDb {
  id: string
  guia_type: string
  guia_number_prestador: string
  status: string
  validation_errors: { field: string; message: string }[] | null
  frozen_amount_cents: number
  lote_id: string | null
  health_plan_id: string
  created_at: string
}

interface LoteDb {
  id: string
  lote_number: string
  status: string
  health_plan_id: string
  xml_hash_md5: string | null
  signed_at: string | null
  created_at: string
}

export default async function TissPanelPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin' && session.role !== 'financeiro') {
    redirect('/operacao/atendimentos')
  }

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  const [plansRes, guiasRes, lotesRes] = await Promise.all([
    supabase.from('health_plans').select('id, name').eq('tenant_id', session.tenantId),
    supabase
      .from('tiss_guias' as never)
      .select(
        'id, guia_type, guia_number_prestador, status, validation_errors, frozen_amount_cents, lote_id, health_plan_id, created_at',
      )
      .eq('tenant_id', session.tenantId)
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('tiss_lotes' as never)
      .select(
        'id, lote_number, status, health_plan_id, xml_hash_md5, signed_at, created_at',
      )
      .eq('tenant_id', session.tenantId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const planName = new Map<string, string>()
  for (const p of (plansRes.data ?? []) as Array<{ id: string; name: string }>) {
    planName.set(p.id, p.name)
  }

  const guiasDb = (guiasRes.data ?? []) as unknown as GuiaDb[]
  const lotesDb = (lotesRes.data ?? []) as unknown as LoteDb[]

  const guias: GuiaRow[] = guiasDb.map((g) => ({
    id: g.id,
    number: g.guia_number_prestador,
    type: g.guia_type,
    status: g.status,
    planId: g.health_plan_id,
    planName: planName.get(g.health_plan_id) ?? 'Convênio',
    amountCents: Number(g.frozen_amount_cents ?? 0),
    loteId: g.lote_id,
    pendingCount: g.validation_errors?.length ?? 0,
    createdAt: g.created_at,
  }))

  // Guias prontas (sem lote) agrupadas por operadora — base do lote.
  const prontaByPlan = new Map<string, PlanGroup>()
  for (const g of guias) {
    if (g.status !== 'pronta' || g.loteId) continue
    const group = prontaByPlan.get(g.planId) ?? {
      planId: g.planId,
      planName: g.planName,
      guias: [],
    }
    group.guias.push(g)
    prontaByPlan.set(g.planId, group)
  }

  const guiaCountByLote = new Map<string, number>()
  for (const g of guias) {
    if (g.loteId) guiaCountByLote.set(g.loteId, (guiaCountByLote.get(g.loteId) ?? 0) + 1)
  }

  const lotes: LoteRow[] = lotesDb.map((l) => ({
    id: l.id,
    number: l.lote_number,
    status: l.status,
    planName: planName.get(l.health_plan_id) ?? 'Convênio',
    hashMd5: l.xml_hash_md5,
    signedAt: l.signed_at,
    guiaCount: guiaCountByLote.get(l.id) ?? 0,
    createdAt: l.created_at,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <FileText className="h-6 w-6 text-primary" />
          Faturamento TISS
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Agrupe as guias prontas por convênio em lotes, assine e baixe o XML para enviar
          ao portal da operadora.
        </p>
      </div>

      <TissPanel
        prontaByPlan={Array.from(prontaByPlan.values())}
        guias={guias}
        lotes={lotes}
      />
    </div>
  )
}
