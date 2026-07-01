import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, FileText, Stethoscope, Users } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { summaryByProfessional } from '@/lib/core/reports/by-professional'
import type { Database } from '@/lib/db/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PeriodShortcuts } from '@/components/ui/period-shortcuts'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ReportsSubNav } from '../reports-sub-nav'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { from?: string; to?: string }
}

export default async function PorProfissionalPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'report.read')) redirect('/operacao/atendimentos')

  const period = resolvePeriod(searchParams)
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  const summary = await summaryByProfessional(supabase, {
    tenantId: session.tenantId,
    from: period.from,
    to: period.to,
  })

  const totalProcedures = summary.reduce((acc, s) => acc + s.procedureCount, 0)
  const totalRevenue = summary.reduce((acc, s) => acc + s.totalRevenueCents, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Relatório por profissional
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Procedimentos e comissões por profissional —{' '}
          <span className="font-semibold">{formatDate(period.from)}</span> a{' '}
          <span className="font-semibold">{formatDate(period.to)}</span>
        </p>
      </div>

      <ReportsSubNav active="por-profissional" />

      <Card>
        <CardContent className="space-y-3 p-4">
          <PeriodShortcuts
            basePath="/analise/relatorios/por-profissional"
            currentFrom={period.from}
            currentTo={period.to}
          />
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryStat label="Profissionais ativos" value={summary.length.toString()} />
        <SummaryStat label="Procedimentos no período" value={totalProcedures.toString()} />
        <SummaryStat
          label="Faturamento no período"
          value={formatCurrency(totalRevenue)}
          highlight
        />
      </div>

      {summary.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-6 text-center text-sm text-slate-500">
            Nenhum profissional ativo cadastrado.{' '}
            <Link
              href="/configuracoes/profissionais"
              className="font-semibold text-link hover:text-link-hover underline"
            >
              Cadastrar profissional
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {summary.map((row) => (
            <ProfessionalCard key={row.doctorId} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProfessionalCard({
  row,
}: {
  row: {
    doctorId: string
    doctorName: string
    role: string | null
    specialty: string | null
    procedureCount: number
    totalRevenueCents: number
    totalCommissionCents: number
  }
}) {
  const meta = [row.role, row.specialty].filter(Boolean).join(' · ') || '—'
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Stethoscope className="h-4 w-4 text-primary" />
          {row.doctorName}
        </CardTitle>
        <p className="mt-1 text-[11px] text-slate-500">{meta}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Procedimentos
            </p>
            <p className="text-xl font-black text-slate-900 tabular-nums">{row.procedureCount}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Comissão
            </p>
            <p className="text-xl font-black text-success-strong tabular-nums">
              {formatCurrency(row.totalCommissionCents)}
            </p>
          </div>
        </div>
        <Link
          href={`/analise/relatorios/por-profissional/${row.doctorId}`}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-slate-800"
        >
          <FileText className="h-3 w-3" />
          Ver detalhes
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  )
}

function SummaryStat({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 inline-flex rounded-xl border border-info/30 bg-info-bg p-2.5 text-info-text">
          <Users className="h-4 w-4" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <p
          className={
            highlight
              ? 'mt-2 text-2xl font-black tabular-nums text-success-strong'
              : 'mt-2 text-2xl font-black tabular-nums text-slate-900'
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

function resolvePeriod(sp: PageProps['searchParams']): { from: string; to: string } {
  const fromValid = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null
  const toValid = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : null
  if (fromValid && toValid && fromValid <= toValid) return { from: fromValid, to: toValid }
  return currentMonthRange(new Date())
}

function currentMonthRange(ref: Date): { from: string; to: string } {
  const year = ref.getFullYear()
  const month = ref.getMonth()
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  return { from: toYmd(first), to: toYmd(last) }
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
