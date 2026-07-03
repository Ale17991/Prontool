import { redirect } from 'next/navigation'
import { Wallet, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPlanReceivables, type ReceiptStatus } from '@/lib/core/plan-receivables/list'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { ReceivablesTable } from './receivables-table'

export const dynamic = 'force-dynamic'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const STATUSES = new Set(['pendente', 'recebido', 'glosado', 'nao_recebido'])

interface PageProps {
  searchParams: {
    from?: string
    to?: string
    plan?: string
    status?: string
    doctor?: string
    q?: string
  }
}

export default async function RecebiveisConvenioPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin' && session.role !== 'financeiro') {
    redirect('/operacao/atendimentos')
  }

  const now = new Date()
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const todayStr = now.toISOString().slice(0, 10)
  const from = searchParams.from && DATE.test(searchParams.from) ? searchParams.from : firstDay
  const to = searchParams.to && DATE.test(searchParams.to) ? searchParams.to : todayStr
  const planFilter = searchParams.plan && searchParams.plan !== 'all' ? searchParams.plan : null
  const doctorFilter =
    searchParams.doctor && searchParams.doctor !== 'all' ? searchParams.doctor : null
  const search = searchParams.q?.trim() || null
  const statusFilter =
    searchParams.status && STATUSES.has(searchParams.status)
      ? (searchParams.status as ReceiptStatus)
      : 'all'

  const supabase = createSupabaseServiceClient()

  const [plansRes, doctorsRes] = await Promise.all([
    supabase
      .from('health_plans')
      .select('id, name')
      .eq('tenant_id', session.tenantId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('doctors')
      .select('id, full_name')
      .eq('tenant_id', session.tenantId)
      .eq('active', true)
      .order('full_name', { ascending: true }),
  ])
  const plans = (plansRes.data ?? []) as Array<{ id: string; name: string }>
  const doctors = (doctorsRes.data ?? []) as Array<{ id: string; full_name: string }>

  const rows = await listPlanReceivables(supabase, {
    tenantId: session.tenantId,
    from,
    to,
    planId: planFilter,
    doctorId: doctorFilter,
    status: statusFilter,
    search,
    encryptionKey: process.env.PATIENT_DATA_ENCRYPTION_KEY,
  })

  // Resumo (sobre o filtro atual) — recebido × pendente × demais.
  const sum = (st: ReceiptStatus) =>
    rows.filter((r) => r.status === st).reduce((a, r) => a + r.amountCents, 0)
  const totalCents = rows.reduce((a, r) => a + r.amountCents, 0)
  const recebidoCents = sum('recebido')
  const pendenteCents = sum('pendente')
  const glosadoCents = sum('glosado')
  const naoRecebidoCents = sum('nao_recebido')

  const canManage = true // admin/financeiro garantido acima

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Recebíveis do convênio
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Status de recebimento por procedimento de convênio. Selecione e marque em massa.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard
          label="Faturado (filtro)"
          value={formatCurrency(totalCents)}
          icon={<Wallet className="h-4 w-4" />}
        />
        <SummaryCard
          label="Recebido"
          value={formatCurrency(recebidoCents)}
          icon={<CheckCircle2 className="h-4 w-4 text-success-text" />}
        />
        <SummaryCard
          label="Pendente"
          value={formatCurrency(pendenteCents)}
          icon={<Clock className="h-4 w-4 text-[hsl(var(--warning-foreground))]" />}
        />
        <SummaryCard
          label="Glosado / não recebido"
          value={formatCurrency(glosadoCents + naoRecebidoCents)}
          icon={<XCircle className="h-4 w-4 text-destructive" />}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-sm">
            {rows.length} procedimento{rows.length === 1 ? '' : 's'}
          </CardTitle>
          <form method="GET" className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500">Buscar</label>
              <Input
                type="search"
                name="q"
                defaultValue={search ?? ''}
                placeholder="Paciente, procedimento, profissional…"
                className="h-8 w-56 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500">De</label>
              <Input type="date" name="from" defaultValue={from} className="h-8 w-36 text-xs" />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500">Até</label>
              <Input type="date" name="to" defaultValue={to} className="h-8 w-36 text-xs" />
            </div>
            <Select name="doctor" defaultValue={doctorFilter ?? 'all'}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue placeholder="Profissional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os profissionais</SelectItem>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select name="plan" defaultValue={planFilter ?? 'all'}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="Convênio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os convênios</SelectItem>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select name="status" defaultValue={statusFilter}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="recebido">Recebido</SelectItem>
                <SelectItem value="glosado">Glosado</SelectItem>
                <SelectItem value="nao_recebido">Não recebido</SelectItem>
              </SelectContent>
            </Select>
            <button
              type="submit"
              className="h-8 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Filtrar
            </button>
          </form>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-slate-500">
              Nenhum procedimento de convênio no filtro atual.
            </p>
          ) : (
            <ReceivablesTable rows={rows} canManage={canManage} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard(props: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-slate-50 p-2 text-slate-500">{props.icon}</div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {props.label}
          </p>
          <p className="text-base font-bold tabular-nums text-slate-900">{props.value}</p>
        </div>
      </CardContent>
    </Card>
  )
}
