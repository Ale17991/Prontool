import { redirect } from 'next/navigation'
import { FileSpreadsheet, Grid3x3 } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { buildDoctorPlanMatrix } from '@/lib/core/reports/doctor-plan-matrix'
import type { Database } from '@/lib/db/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PeriodShortcuts } from '@/components/ui/period-shortcuts'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ReportsSubNav } from '../reports-sub-nav'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { from?: string; to?: string }
}

export default async function MedicoPlanoPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'report.read')) redirect('/operacao/atendimentos')

  const period = resolvePeriod(searchParams)
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  const matrix = await buildDoctorPlanMatrix(supabase, {
    tenantId: session.tenantId,
    from: period.from,
    to: period.to,
  })

  const canExport = can(session.role, 'report.export')
  const exportQs = `from=${period.from}&to=${period.to}`

  // Colunas de plano na ordem do rollup (maior faturamento primeiro).
  const planCols = matrix.byPlan.map((p) => ({ planId: p.planId, planName: p.planName }))
  const grossByKey = new Map<string, number>()
  for (const c of matrix.cells) grossByKey.set(`${c.doctorId}|${c.planId}`, c.grossCents)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Médico × convênio
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Faturamento de cada profissional por convênio —{' '}
          <span className="font-semibold">{formatDate(period.from)}</span> a{' '}
          <span className="font-semibold">{formatDate(period.to)}</span>
        </p>
      </div>

      <ReportsSubNav active="medico-plano" />

      <Card>
        <CardContent className="space-y-3 p-4">
          <PeriodShortcuts
            basePath="/analise/relatorios/medico-plano"
            currentFrom={period.from}
            currentTo={period.to}
          />
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <form
              method="get"
              className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              <div className="space-y-1.5">
                <Label htmlFor="from" className="text-xs">
                  Data início
                </Label>
                <Input id="from" name="from" type="date" defaultValue={period.from} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to" className="text-xs">
                  Data fim
                </Label>
                <Input id="to" name="to" type="date" defaultValue={period.to} required />
              </div>
              <Button type="submit">Atualizar</Button>
            </form>
            {canExport ? (
              <a
                href={`/api/relatorios/medico-plano/export/excel?${exportQs}`}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Excel
              </a>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {matrix.cells.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-10 text-center text-sm text-slate-500">
            Nenhum atendimento ativo no período.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-white">
                    <span className="inline-flex items-center gap-1.5">
                      <Grid3x3 className="h-3.5 w-3.5 text-primary" />
                      Profissional
                    </span>
                  </TableHead>
                  {planCols.map((p) => (
                    <TableHead key={p.planId || 'particular'} className="text-right">
                      {p.planName}
                    </TableHead>
                  ))}
                  <TableHead className="text-right font-black">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrix.byDoctor.map((d) => (
                  <TableRow key={d.doctorId}>
                    <TableCell className="sticky left-0 bg-white font-semibold text-slate-900">
                      {d.doctorName}
                    </TableCell>
                    {planCols.map((p) => {
                      const v = grossByKey.get(`${d.doctorId}|${p.planId}`)
                      return (
                        <TableCell
                          key={p.planId || 'particular'}
                          className="text-right tabular-nums text-slate-700"
                        >
                          {v ? formatCurrency(v) : '—'}
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-right font-black tabular-nums text-slate-900">
                      {formatCurrency(d.grossCents)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-slate-200 bg-slate-50">
                  <TableCell className="sticky left-0 bg-slate-50 font-black text-slate-900">
                    Total
                  </TableCell>
                  {planCols.map((p) => {
                    const planTotal =
                      matrix.byPlan.find((bp) => bp.planId === p.planId)?.grossCents ?? 0
                    return (
                      <TableCell
                        key={p.planId || 'particular'}
                        className="text-right font-bold tabular-nums text-slate-900"
                      >
                        {formatCurrency(planTotal)}
                      </TableCell>
                    )
                  })}
                  <TableCell className="text-right font-black tabular-nums text-slate-900">
                    {formatCurrency(matrix.totals.grossCents)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function resolvePeriod(sp: PageProps['searchParams']): { from: string; to: string } {
  const fromValid = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null
  const toValid = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : null
  if (fromValid && toValid && fromValid <= toValid) return { from: fromValid, to: toValid }
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
