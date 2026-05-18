import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeft,
  Award,
  Calculator,
  Calendar,
  FileSpreadsheet,
  FileText,
  Stethoscope,
  Wallet,
} from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { detailByProfessional } from '@/lib/core/reports/by-professional'
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
  params: { doctorId: string }
  searchParams: { from?: string; to?: string }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PorProfissionalDetailPage({ params, searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'report.read')) redirect('/operacao/atendimentos')

  if (!UUID_RE.test(params.doctorId)) notFound()

  const period = resolvePeriod(searchParams)
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  const detail = await detailByProfessional(supabase, {
    tenantId: session.tenantId,
    doctorId: params.doctorId,
    from: period.from,
    to: period.to,
  })

  const canExport = can(session.role, 'report.export')
  const exportQs = `from=${period.from}&to=${period.to}`
  const registro = formatRegistro(detail.doctor)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/analise/relatorios/por-profissional"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para todos os profissionais
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
          {detail.doctor.fullName}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          {detail.doctor.role ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
              {detail.doctor.role}
            </span>
          ) : null}
          {detail.doctor.specialty ? (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
              {detail.doctor.specialty}
            </span>
          ) : null}
          {registro ? (
            <span className="font-mono text-xs text-slate-500">{registro}</span>
          ) : null}
        </div>
      </div>

      <ReportsSubNav active="por-profissional" />

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
                  href={`/api/relatorios/por-profissional/${params.doctorId}/export/excel?${exportQs}`}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Excel
                </a>
                <a
                  href={`/api/relatorios/por-profissional/${params.doctorId}/export/pdf?${exportQs}`}
                  className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-slate-800"
                >
                  <FileText className="h-3.5 w-3.5" />
                  PDF
                </a>
              </div>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {formatDate(period.from)} a {formatDate(period.to)}
          </p>
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
          icon={Wallet}
          label="Total de comissão"
          value={formatCurrency(detail.totals.totalCommissionCents)}
          highlight
        />
        <SummaryCard
          icon={Award}
          label="Procedimento mais realizado"
          value={detail.topProcedure ? detail.topProcedure.procedureName : '—'}
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
              Nenhum procedimento ativo neste profissional no período.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Procedimento</TableHead>
                  <TableHead>Plano/Particular</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.procedures.map((row, idx) => (
                  <TableRow key={`${row.appointmentId}-${row.procedureId}-${idx}`}>
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
                    <TableCell className="text-slate-700">{row.planName}</TableCell>
                    <TableCell className="text-right font-bold text-slate-900 tabular-nums">
                      {formatCurrency(row.amountCents)}
                    </TableCell>
                    <TableCell className="text-right font-bold text-success-strong tabular-nums">
                      {formatCurrency(row.commissionCents)}
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
        <div className="mb-3 inline-flex rounded-xl border border-blue-100 bg-blue-50 p-2.5 text-primary">
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

function formatRegistro(d: {
  councilName: string | null
  councilNumber: string | null
  crm: string | null
}): string | null {
  const council = d.councilName ?? null
  const number = d.councilNumber ?? d.crm ?? null
  if (!council && !number) return null
  return [council, number].filter(Boolean).join(' ')
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
