import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, DollarSign, FileText } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface PlanRow {
  id: string
  name: string
  active: boolean
}

interface PriceVersionRow {
  procedure_id: string
  plan_id: string
  amount_cents: number
  valid_from: string
  created_at: string
}

export default async function PrecosHubPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  const asOf = new Date().toISOString().slice(0, 10)

  // RLS filtra por tenant_id automaticamente via jwt_tenant_id() nas policies
  // health_plans_read e price_versions_read — não precisa de .eq('tenant_id').
  const [plansRes, pricesRes] = await Promise.all([
    supabase
      .from('health_plans')
      .select('id, name, active')
      .order('active', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('price_versions')
      .select('procedure_id, plan_id, amount_cents, valid_from, created_at')
      .lte('valid_from', asOf)
      .order('valid_from', { ascending: false })
      .order('created_at', { ascending: false }),
  ])
  if (plansRes.error) throw new Error(`plans lookup: ${plansRes.error.message}`)
  if (pricesRes.error) throw new Error(`price lookup: ${pricesRes.error.message}`)

  const plans = (plansRes.data ?? []) as PlanRow[]
  const prices = (pricesRes.data ?? []) as PriceVersionRow[]

  // Para cada plano, reduz pra uma head por procedure_id (primeira ocorrência
  // após o ORDER BY já é a vigente). Depois agrega contagem e ticket médio.
  const stats = new Map<string, { count: number; total: number }>()
  const seenPairs = new Set<string>()
  for (const p of prices) {
    const pairKey = `${p.plan_id}::${p.procedure_id}`
    if (seenPairs.has(pairKey)) continue
    seenPairs.add(pairKey)
    const current = stats.get(p.plan_id) ?? { count: 0, total: 0 }
    current.count += 1
    current.total += p.amount_cents
    stats.set(p.plan_id, current)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Tabelas de Convênio
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {plans.length} convênio{plans.length === 1 ? '' : 's'} cadastrado
          {plans.length === 1 ? '' : 's'}. Cada convênio tem sua própria tabela de
          procedimentos com valores — clique em um para gerenciar preços.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {plans.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <FileText className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                Nenhum convênio cadastrado.{' '}
                <Link href="/cadastros/planos" className="font-bold text-primary underline">
                  Cadastrar o primeiro convênio
                </Link>
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Convênio</TableHead>
                  <TableHead className="text-right">Procedimentos precificados</TableHead>
                  <TableHead className="text-right">Ticket médio</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => {
                  const s = stats.get(plan.id) ?? { count: 0, total: 0 }
                  const avg = s.count > 0 ? Math.round(s.total / s.count) : 0
                  return (
                    <TableRow key={plan.id} className="group">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                            <DollarSign className="h-4 w-4" />
                          </div>
                          <p className="font-bold text-slate-900">{plan.name}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums text-slate-900">
                        {s.count}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-slate-700">
                        {s.count > 0 ? formatCurrency(avg) : '—'}
                      </TableCell>
                      <TableCell>
                        {plan.active ? (
                          <Badge variant="success">Ativo</Badge>
                        ) : (
                          <Badge variant="secondary">Inativo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/cadastros/planos/${plan.id}`}
                          className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                        >
                          Abrir tabela <ChevronRight className="h-3 w-3" />
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
