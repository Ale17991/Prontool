import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Calendar, DollarSign, History } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { EditPriceForm } from './edit-price-form'

export const dynamic = 'force-dynamic'

interface VersionRow {
  id: string
  procedure_id: string
  plan_id: string
  amount_cents: number
  valid_from: string
  created_at: string
  created_by: string | null
  reason: string | null
  previous_version_id: string | null
  procedures: { tuss_code: string; display_name: string | null } | null
  health_plans: { name: string } | null
}

export default async function PrecoDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: seedRaw, error: seedErr } = await supabase
    .from('price_versions')
    .select(
      'id, procedure_id, plan_id, amount_cents, valid_from, created_at, created_by, reason, previous_version_id, procedures(tuss_code, display_name), health_plans(name)',
    )
    .eq('id', params.id)
    .maybeSingle()
  if (seedErr) throw new Error(seedErr.message)
  const seed = seedRaw as unknown as VersionRow | null
  if (!seed) notFound()

  const today = new Date().toISOString().slice(0, 10)
  const { data: chainRaw } = await supabase
    .from('price_versions')
    .select(
      'id, procedure_id, plan_id, amount_cents, valid_from, created_at, created_by, reason, previous_version_id, procedures(tuss_code, display_name), health_plans(name)',
    )
    .eq('procedure_id', seed.procedure_id)
    .eq('plan_id', seed.plan_id)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
  const chain = (chainRaw ?? []) as unknown as VersionRow[]

  const currentHead =
    chain.find((v) => v.valid_from <= today) ?? chain[chain.length - 1] ?? seed
  const editableHead = chain[0] ?? seed
  const canWrite = can(session.role, 'price.write')

  const seedFuture = seed.valid_from > today

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/cadastros/precos"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-3 w-3" /> Voltar para preços
          </Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
            {seed.procedures?.display_name ?? seed.procedures?.tuss_code ?? 'Preço'}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            TUSS <span className="font-mono font-bold text-primary">{seed.procedures?.tuss_code}</span>{' '}
            · Convênio <span className="font-semibold">{seed.health_plans?.name}</span>
          </p>
        </div>
        {seedFuture ? (
          <Badge variant="warning">Vigência futura</Badge>
        ) : (
          <Badge variant="success">Vigente</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard
          label="Valor desta versão"
          value={formatCurrency(seed.amount_cents)}
          icon={DollarSign}
        />
        <SummaryCard
          label="Vigência a partir de"
          value={formatDate(seed.valid_from)}
          icon={Calendar}
        />
        <SummaryCard
          label="Head atual (hoje)"
          value={formatCurrency(currentHead.amount_cents)}
          icon={DollarSign}
          sub={
            currentHead.id === seed.id
              ? 'Esta é a versão vigente hoje'
              : `Vigente desde ${formatDate(currentHead.valid_from)}`
          }
        />
      </div>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Criar nova versão</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-xs text-slate-500">
              A versão atual permanece imutável. A nova versão entra em vigor a partir da data
              informada e é encadeada à atual via <code>expected_head_id</code> para evitar
              sobrescrita concorrente.
            </p>
            <EditPriceForm
              procedureId={seed.procedure_id}
              planId={seed.plan_id}
              expectedHeadId={editableHead.id}
              currentAmountCents={editableHead.amount_cents}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-primary" />
            Histórico de versões
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vigência</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead>Autor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chain.map((v) => (
                <TableRow
                  key={v.id}
                  className={v.id === seed.id ? 'bg-blue-50/40' : undefined}
                >
                  <TableCell className="text-slate-700">{formatDate(v.valid_from)}</TableCell>
                  <TableCell className="font-bold text-slate-900">
                    {formatCurrency(v.amount_cents)}
                  </TableCell>
                  <TableCell className="max-w-sm text-xs text-slate-600">
                    {v.reason ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {formatDateTime(v.created_at)}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-slate-500">
                    {(v.created_by ?? '—').slice(0, 8)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  icon: typeof DollarSign
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-3 inline-flex rounded-xl border border-blue-100 bg-blue-50 p-2.5 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p className="text-xl font-black tracking-tight text-slate-900">{value}</p>
        {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
      </CardContent>
    </Card>
  )
}
