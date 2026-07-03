import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, DollarSign, FileText } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/utils'
import { NewPlanForm } from './new-plan-form'
import { TogglePlanActive } from './toggle-plan-active'

export const dynamic = 'force-dynamic'

interface PlanRow {
  id: string
  name: string
  active: boolean
  created_at: string
}

interface PriceVersionRow {
  procedure_id: string
  plan_id: string
  amount_cents: number
  valid_from: string
  created_at: string
}

export default async function ConveniosPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  const asOf = new Date().toISOString().slice(0, 10)

  // Carrega convênios + price_versions vigentes em paralelo. RLS filtra
  // por tenant_id automaticamente (jwt_tenant_id() nas policies).
  const [plansRes, pricesRes] = await Promise.all([
    supabase
      .from('health_plans')
      .select('id, name, active, created_at')
      .order('active', { ascending: false })
      .order('name', { ascending: true })
      .limit(500),
    supabase
      .from('price_versions')
      .select('procedure_id, plan_id, amount_cents, valid_from, created_at')
      .lte('valid_from', asOf)
      .order('valid_from', { ascending: false })
      .order('created_at', { ascending: false }),
  ])
  if (pricesRes.error) {
    throw new Error(`price lookup: ${pricesRes.error.message}`)
  }

  const rows = (plansRes.data ?? []) as PlanRow[]
  const prices = (pricesRes.data ?? []) as PriceVersionRow[]

  // Para cada (plano, procedimento), pega só a versão vigente (primeira após
  // ORDER BY valid_from desc). Depois agrega contagem e ticket médio por plano.
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

  const canWrite = can(session.role, 'plan.write')
  const activeCount = rows.filter((r) => r.active).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Convênios</h1>
        <p className="mt-1 text-sm text-slate-500">
          {rows.length} convênio{rows.length === 1 ? '' : 's'} · {activeCount} ativo
          {activeCount === 1 ? '' : 's'}. Cada convênio tem sua tabela de procedimentos com valores
          — clique em &quot;Abrir&quot; para gerenciar preços.
        </p>
      </div>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-primary" />
              Novo convênio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <NewPlanForm />
            <p className="mt-3 text-[11px] text-slate-500">
              Nomes são imutáveis após o cadastro — preserva integridade dos relatórios históricos.
              Para encerrar, desative.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {plansRes.error ? (
        <Card>
          <CardContent className="px-6 py-12 text-sm text-destructive">
            Erro: {plansRes.error.message}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <FileText className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">Nenhum convênio cadastrado.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Convênio</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Procedimentos</TableHead>
                  <TableHead className="text-right">Ticket médio</TableHead>
                  <TableHead>Cadastrado em</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const s = stats.get(p.id) ?? { count: 0, total: 0 }
                  const avg = s.count > 0 ? Math.round(s.total / s.count) : 0
                  return (
                    <TableRow key={p.id} className="group">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                            <DollarSign className="h-4 w-4" />
                          </div>
                          <p className="font-bold text-slate-900">{p.name}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {p.active ? (
                          <Badge variant="success">Ativo</Badge>
                        ) : (
                          <Badge variant="secondary">Inativo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums text-slate-900">
                        {s.count}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-slate-700">
                        {s.count > 0 ? formatCurrency(avg) : '—'}
                      </TableCell>
                      <TableCell className="text-slate-700">{formatDate(p.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-3">
                          {canWrite ? <TogglePlanActive planId={p.id} active={p.active} /> : null}
                          <Link
                            href={`/configuracoes/convenios/${p.id}`}
                            className="inline-flex items-center gap-1 text-xs font-bold text-link hover:text-link-hover hover:underline"
                          >
                            Abrir <ChevronRight className="h-3 w-3" />
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
