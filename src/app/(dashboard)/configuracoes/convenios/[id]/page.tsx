import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, DollarSign } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  PlanProceduresSection,
  type ProcedureOption,
  type PriceHeadWithProcedure,
} from './plan-procedures-section'
import { PlanTaxRateForm } from './plan-tax-rate-form'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: { id: string }
}

export default async function PlanoDetailPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()

  // RLS policies health_plans_read / procedures_read / price_versions_read
  // filtram por tenant_id = jwt_tenant_id() — o filtro explícito sai.
  const planRes = await supabase
    .from('health_plans')
    .select('id, name, active, created_at, tax_rate_bps')
    .eq('id', params.id)
    .maybeSingle()
  if (planRes.error) throw new Error(`plan lookup: ${planRes.error.message}`)
  if (!planRes.data) notFound()
  const plan = planRes.data as {
    id: string
    name: string
    active: boolean
    created_at: string
    tax_rate_bps: number
  }

  // Covered-by-plan active procedures — base set for the "Adicionar
  // procedimento" typeahead. Filtering out already-priced ones é feito
  // client-side pra nao precisar refetch depois de adicionar.
  // Inclui procedimentos NAO-LISTADOS com pacote negociado por plano
  // (migration 0067) — tuss_code é NULL, exibimos o código personalizado
  // (migration 0072/0073) ou o rótulo "Não listado".
  // tuss_codes.description é carregado para que a busca por nome casa
  // procedimentos TUSS-coded sem display_name customizado (ex.: o usuário
  // cadastrou TUSS 30306027 sem renomear → busca por "facectomia" precisa
  // achar pelo catálogo TUSS, senão o procedimento "some" da lista).
  const procRes = await supabase
    .from('procedures')
    .select(
      'id, tuss_code, display_name, is_unlisted, custom_code_id, ' +
        'tuss_codes!procedures_tuss_code_fkey(description), ' +
        'custom_procedure_codes:custom_code_id(code, description)',
    )
    .eq('active', true)
    .eq('covered_by_plan', true)
    .is('deleted_at', null)
    .order('display_name', { ascending: true, nullsFirst: false })
    .limit(1000)
  if (procRes.error) throw new Error(`procedures lookup: ${procRes.error.message}`)
  const procedures: ProcedureOption[] = (
    (procRes.data ?? []) as Array<{
      id: string
      tuss_code: string | null
      display_name: string | null
      is_unlisted: boolean | null
      custom_code_id: string | null
      tuss_codes: { description: string } | null
      custom_procedure_codes: { code: string; description: string | null } | null
    }>
  ).map((p) => {
    const customCode = p.custom_procedure_codes?.code ?? null
    // Label do código: TUSS para listados, código personalizado quando há,
    // "Não listado" como fallback para unlisted sem código.
    const codeLabel = p.tuss_code ?? customCode ?? 'Não listado'
    // Descrição de catálogo (TUSS oficial ou código personalizado) — usada
    // como fallback na busca por nome e na exibição.
    const catalogDescription =
      p.tuss_codes?.description ?? p.custom_procedure_codes?.description ?? null
    return {
      id: p.id,
      tussCode: codeLabel,
      displayName: p.display_name,
      catalogDescription,
      isUnlisted: p.is_unlisted === true,
      isCustomCoded: customCode !== null,
    }
  })

  // Price-version history (whole chain, not just vigente) for this plan.
  // Reduce to one head per procedure in memory.
  const asOf = new Date().toISOString().slice(0, 10)
  const pvRes = await supabase
    .from('price_versions')
    .select('id, procedure_id, amount_cents, valid_from, created_at')
    .eq('plan_id', params.id)
    .lte('valid_from', asOf)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
  if (pvRes.error) throw new Error(`price_versions lookup: ${pvRes.error.message}`)
  const rawHeads = (pvRes.data ?? []) as Array<{
    id: string
    procedure_id: string
    amount_cents: number
    valid_from: string
    created_at: string
  }>

  const seen = new Set<string>()
  const headsRaw: Array<{
    priceVersionId: string
    procedureId: string
    amountCents: number
    validFrom: string
  }> = []
  for (const v of rawHeads) {
    if (seen.has(v.procedure_id)) continue
    seen.add(v.procedure_id)
    headsRaw.push({
      priceVersionId: v.id,
      procedureId: v.procedure_id,
      amountCents: v.amount_cents,
      validFrom: v.valid_from,
    })
  }

  // Enrich with procedure metadata (name + TUSS). Procedure may have been
  // deactivated/flipped to particular after pricing — we still show the
  // historical head but flag it so admins can clean up.
  const headProcedureIds = headsRaw.map((h) => h.procedureId)
  const procMetaRes = headProcedureIds.length
    ? await supabase
        .from('procedures')
        .select(
          'id, tuss_code, display_name, covered_by_plan, active, is_unlisted, ' +
            'tuss_codes!procedures_tuss_code_fkey(description), ' +
            'custom_procedure_codes:custom_code_id(code, description)',
        )
        .in('id', headProcedureIds)
    : {
        data: [] as Array<{
          id: string
          tuss_code: string | null
          display_name: string | null
          covered_by_plan: boolean
          active: boolean
          is_unlisted: boolean | null
          tuss_codes: { description: string } | null
          custom_procedure_codes: { code: string; description: string | null } | null
        }>,
        error: null,
      }
  if (procMetaRes.error) throw new Error(`proc meta: ${procMetaRes.error.message}`)
  type ProcMeta = {
    id: string
    tuss_code: string | null
    display_name: string | null
    covered_by_plan: boolean
    active: boolean
    is_unlisted: boolean | null
    tuss_codes: { description: string } | null
    custom_procedure_codes: { code: string; description: string | null } | null
  }
  const procMeta = new Map(
    ((procMetaRes.data ?? []) as unknown as ProcMeta[]).map((p) => [p.id, p]),
  )
  const heads: PriceHeadWithProcedure[] = headsRaw.map((h) => {
    const meta = procMeta.get(h.procedureId)
    const customCode = meta?.custom_procedure_codes?.code ?? null
    const codeLabel = meta?.tuss_code ?? customCode ?? '—'
    const catalogDescription =
      meta?.tuss_codes?.description ?? meta?.custom_procedure_codes?.description ?? null
    return {
      priceVersionId: h.priceVersionId,
      procedureId: h.procedureId,
      tussCode: codeLabel,
      displayName: meta?.display_name ?? catalogDescription ?? null,
      amountCents: h.amountCents,
      validFrom: h.validFrom,
      procedureActive: meta?.active ?? false,
      procedureCovered: meta?.covered_by_plan ?? false,
    }
  })

  const canWrite = can(session.role, 'price.write')

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/configuracoes/convenios"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para convênios
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-black tracking-tight text-slate-900">{plan.name}</h1>
          {plan.active ? (
            <Badge variant="success">Ativo</Badge>
          ) : (
            <Badge variant="secondary">Inativo</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Convênio cadastrado em {formatDate(plan.created_at)}. Alterações de preço criam
          uma nova versão (append-only) — atendimentos passados preservam o valor congelado
          na data em que ocorreram.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard
          label="Procedimentos com preço"
          value={heads.length.toString()}
        />
        <SummaryCard
          label="Ticket médio"
          value={
            heads.length > 0
              ? formatCurrency(
                  Math.round(heads.reduce((a, h) => a + h.amountCents, 0) / heads.length),
                )
              : '—'
          }
        />
        <SummaryCard
          label="Maior valor vigente"
          value={
            heads.length > 0
              ? formatCurrency(Math.max(...heads.map((h) => h.amountCents)))
              : '—'
          }
        />
      </div>

      <PlanTaxRateForm
        planId={plan.id}
        initialTaxRateBps={plan.tax_rate_bps ?? 0}
        canWrite={can(session.role, 'plan.write')}
      />

      <PlanProceduresSection
        planId={plan.id}
        planName={plan.name}
        initialHeads={heads}
        procedures={procedures}
        canWrite={canWrite}
      />
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-3 inline-flex rounded-xl border border-blue-100 bg-blue-50 p-2.5 text-primary">
          <DollarSign className="h-4 w-4" />
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p className="text-xl font-black tracking-tight text-slate-900">{value}</p>
      </CardContent>
    </Card>
  )
}
