import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, FileText } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import { NewPlanForm } from './new-plan-form'
import { TogglePlanActive } from './toggle-plan-active'

export const dynamic = 'force-dynamic'

interface PlanRow {
  id: string
  name: string
  active: boolean
  created_at: string
}

export default async function PlanosPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: rawRows, error } = await supabase
    .from('health_plans')
    .select('id, name, active, created_at')
    .order('active', { ascending: false })
    .order('name', { ascending: true })
    .limit(500)
  const rows = (rawRows ?? []) as PlanRow[]

  const canWrite = can(session.role, 'plan.write')
  const activeCount = rows.filter((r) => r.active).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Convênios</h1>
        <p className="mt-1 text-sm text-slate-500">
          {rows.length} convênio{rows.length === 1 ? '' : 's'} · {activeCount} ativo
          {activeCount === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
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
                Nomes são imutáveis após o cadastro — isto preserva a integridade dos
                relatórios históricos. Para encerrar um convênio, desative-o.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-8 text-sm text-slate-500">
              Seu perfil tem acesso somente de leitura aos convênios.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cadastrados</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {error ? (
              <p className="px-6 pb-6 text-sm text-rose-600">Erro: {error.message}</p>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <FileText className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-500">
                  Nenhum convênio cadastrado.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Cadastrado em</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id} className="group">
                      <TableCell className="font-semibold text-slate-900">{p.name}</TableCell>
                      <TableCell className="text-slate-700">{formatDate(p.created_at)}</TableCell>
                      <TableCell>
                        {p.active ? (
                          <Badge variant="success">Ativo</Badge>
                        ) : (
                          <Badge variant="secondary">Inativo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-3">
                          {canWrite ? (
                            <TogglePlanActive planId={p.id} active={p.active} />
                          ) : null}
                          <Link
                            href={`/cadastros/planos/${p.id}`}
                            className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                          >
                            Abrir <ChevronRight className="h-3 w-3" />
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
