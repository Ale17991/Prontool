import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeft,
  Award,
  Calculator,
  Calendar,
  Download,
  FileSpreadsheet,
  FileText,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { detailByPlan, PARTICULAR_KEY } from '@/lib/core/reports/by-plan'
import type { Database } from '@/lib/db/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { ReportsSubNav } from '../../reports-sub-nav'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: { planId: string }
  searchParams: { from?: string; to?: string }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PorPlanoDetailPage({ params, searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'report.read')) redirect('/operacao/atendimentos')

  // Particular tem sentinel proprio na URL ('particular'). Para planos
  // normais, exigimos UUID — qualquer outra coisa e 404.
  const isParticular = params.planId === PARTICULAR_KEY
  if (!isParticular && !UUID_RE.test(params.planId)) notFound()

  const period = resolvePeriod(searchParams)
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  const detail = await detailByPlan(supabase, {
    tenantId: session.tenantId,
    planId: isParticular ? null : params.planId,
    from: period.from,
    to: period.to,
  })

  const canExport = can(session.role, 'report.export')
  const exportQs = `from=${period.from}&to=${period.to}`

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/analise/relatorios/por-plano"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para todos os planos
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
          {detail.plan.name}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Procedimentos realizados no plano · {formatDate(period.from)} a{' '}
          {formatDate(period.to)}
        </p>
      </div>

      <ReportsSubNav active="por-plano" />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-primary" />
            Período
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <form
              method="get"
              className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <div className="space-y-1.5">
                <Label htmlFor="from" className="text-xs">
                  Data início
                </Label>
                <Input
                  id="from"
                  name="from"
                  type="date"
                  defaultValue={period.from}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to" className="text-xs">
                  Data fim
                </Label>
                <Input id="to" name="to" type="date" defaultValue={period.to} required />
              </div>
              <div className="flex items-end">
                <Button type="submit">Atualizar</Button>
              </div>
            </form>
            {canExport ? (
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/relatorios/por-plano/${params.planId}/export/excel?${exportQs}`}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Excel
                </a>
                <a
                  href={`/api/relatorios/por-plano/${params.planId}/export/pdf?${exportQs}`}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  PDF
                </a>
                <a
                  href={`/api/relatorios/por-plano/${params.planId}/export/pdf?${exportQs}`}
                  className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-slate-800"
                  title="PDF formatado para envio à operadora"
                >
                  <Download className="h-3.5 w-3.5" />
                  Exportar geral
                </a>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={Stethoscope}
          label="Procedimentos no período"
          value={detail.totals.procedureCount.toString()}
        />
        <SummaryCard
          icon={Calculator}
          label="Valor total faturado"
          value={formatCurrency(detail.totals.totalRevenueCents)}
          highlight
        />
        <SummaryCard
          icon={Award}
          label="Profissional com mais procedimentos"
          value={
            detail.topDoctor
              ? `${detail.topDoctor.doctorName}`
              : '—'
          }
          sub={
            detail.topDoctor
              ? `${detail.topDoctor.count} atend.`
              : 'Sem dados no período'
          }
        />
        <SummaryCard
          icon={ShieldCheck}
          label="Procedimento mais realizado"
          value={
            detail.topProcedure ? detail.topProcedure.procedureName : '—'
          }
          sub={
            detail.topProcedure
              ? `TUSS ${detail.topProcedure.tussCode || '—'} · ${detail.topProcedure.count} vezes`
              : 'Sem dados no período'
          }
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-primary" />
            Procedimentos do período
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {detail.procedures.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">
              Nenhum procedimento ativo neste plano no período.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Procedimento</TableHead>
                  <TableHead>Profissional</TableHead>
                  <TableHead className="w-14 text-center">Qtd</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.procedures.map((row, idx) => (
                  <TableRow key={`${row.appointmentId}-${idx}`}>
                    <TableCell className="text-xs text-slate-700">
                      {formatDateTime(row.appointmentAt)}
                    </TableCell>
                    <TableCell className="font-semibold text-slate-900">
                      {row.patientName}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-slate-900">{row.procedureName}</p>
                      <p className="font-mono text-[10px] text-slate-500">
                        {row.tussCode}
                      </p>
                    </TableCell>
                    <TableCell className="text-slate-700">{row.doctorName}</TableCell>
                    <TableCell className="text-center text-slate-700 tabular-nums">
                      {row.quantity > 1 ? (
                        <span className="font-bold text-slate-900">×{row.quantity}</span>
                      ) : (
                        <span className="text-slate-400">1</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-bold text-slate-900 tabular-nums">
                      {formatCurrency(row.amountCents)}
                      {row.quantity > 1 ? (
                        <span className="ml-1 text-[10px] text-slate-500">
                          ({formatCurrency(row.unitAmountCents)} un.)
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="success">Ativo</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: typeof Calendar
  label: string
  value: string
  sub?: string
  highlight?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 inline-flex rounded-xl border border-info/30 bg-info-bg p-2.5 text-info-text">
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p
          className={
            highlight
              ? 'mt-1 truncate text-xl font-black tracking-tight text-success-strong'
              : 'mt-1 truncate text-xl font-black tracking-tight text-slate-900'
          }
          title={value}
        >
          {value}
        </p>
        {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
      </CardContent>
    </Card>
  )
}

function resolvePeriod(sp: PageProps['searchParams']): { from: string; to: string } {
  const fromValid = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null
  const toValid = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : null
  if (fromValid && toValid && fromValid <= toValid) {
    return { from: fromValid, to: toValid }
  }
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: toYmd(first), to: toYmd(last) }
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
