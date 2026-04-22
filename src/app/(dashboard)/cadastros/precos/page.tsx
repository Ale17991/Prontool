import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, DollarSign, Filter, Plus } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: {
    procedure_id?: string
    plan_id?: string
    as_of?: string
  }
}

interface PriceRow {
  id: string
  procedure_id: string
  plan_id: string
  amount_cents: number
  valid_from: string
  created_at: string
  procedures: { tuss_code: string; display_name: string | null } | null
  health_plans: { name: string } | null
}

interface ProcedureOption {
  id: string
  tuss_code: string
  display_name: string | null
}

interface PlanOption {
  id: string
  name: string
}

export default async function PrecosPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  const asOf = (searchParams.as_of?.match(/^\d{4}-\d{2}-\d{2}$/) ? searchParams.as_of : null) ??
    new Date().toISOString().slice(0, 10)
  const supabase = createSupabaseServerClient()

  let q = supabase
    .from('price_versions')
    .select(
      'id, procedure_id, plan_id, amount_cents, valid_from, created_at, procedures(tuss_code, display_name), health_plans(name)',
    )
    .lte('valid_from', asOf)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000)
  if (searchParams.procedure_id) q = q.eq('procedure_id', searchParams.procedure_id)
  if (searchParams.plan_id) q = q.eq('plan_id', searchParams.plan_id)

  const [pricesRes, proceduresRes, plansRes] = await Promise.all([
    q,
    supabase.from('procedures').select('id, tuss_code, display_name').eq('active', true).order('tuss_code'),
    supabase.from('health_plans').select('id, name').eq('active', true).order('name'),
  ])

  const rows = (pricesRes.data ?? []) as unknown as PriceRow[]
  const procedures = (proceduresRes.data ?? []) as ProcedureOption[]
  const plans = (plansRes.data ?? []) as PlanOption[]

  // Reduce to one head per (procedure, plan)
  const seen = new Set<string>()
  const heads: PriceRow[] = []
  for (const r of rows) {
    const key = `${r.procedure_id}::${r.plan_id}`
    if (seen.has(key)) continue
    seen.add(key)
    heads.push(r)
  }

  const canWrite = can(session.role, 'price.write')

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Tabela de preços</h1>
          <p className="mt-1 text-sm text-slate-500">
            {heads.length} combinação{heads.length === 1 ? '' : 'ões'} com preço vigente em{' '}
            <span className="font-semibold text-slate-700">{formatDate(asOf)}</span>
          </p>
        </div>
        {canWrite ? (
          <Link
            href="/cadastros/precos/novo"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Novo preço
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-primary" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="procedure_id" className="text-xs">
                Procedimento
              </Label>
              <select
                id="procedure_id"
                name="procedure_id"
                defaultValue={searchParams.procedure_id ?? ''}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Todos</option>
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.tuss_code} — {p.display_name ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan_id" className="text-xs">
                Convênio
              </Label>
              <select
                id="plan_id"
                name="plan_id"
                defaultValue={searchParams.plan_id ?? ''}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Todos</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as_of" className="text-xs">
                Vigência em
              </Label>
              <Input id="as_of" name="as_of" type="date" defaultValue={asOf} />
            </div>
            <Button type="submit">Filtrar</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {pricesRes.error ? (
            <p className="px-6 py-8 text-sm text-rose-600">Erro: {pricesRes.error.message}</p>
          ) : heads.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <DollarSign className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                Nenhum preço vigente nessa combinação.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>TUSS / Procedimento</TableHead>
                  <TableHead>Convênio</TableHead>
                  <TableHead>Valor vigente</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {heads.map((r) => {
                  const future = r.valid_from > asOf
                  return (
                    <TableRow key={r.id} className="group">
                      <TableCell>
                        <p className="font-mono text-xs font-bold text-primary">
                          {r.procedures?.tuss_code ?? '—'}
                        </p>
                        <p className="text-xs text-slate-600">
                          {r.procedures?.display_name ?? ''}
                        </p>
                      </TableCell>
                      <TableCell className="font-semibold text-slate-700">
                        {r.health_plans?.name ?? '—'}
                      </TableCell>
                      <TableCell className="font-black text-slate-900">
                        {formatCurrency(r.amount_cents)}
                      </TableCell>
                      <TableCell className="text-slate-700">{formatDate(r.valid_from)}</TableCell>
                      <TableCell>
                        {future ? (
                          <Badge variant="warning">Agendado</Badge>
                        ) : (
                          <Badge variant="success">Vigente</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/cadastros/precos/${r.id}`}
                          className="inline-flex items-center gap-1 text-xs font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          Abrir <ChevronRight className="h-3 w-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
