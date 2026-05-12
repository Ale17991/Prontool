import { redirect } from 'next/navigation'
import { ListChecks, Stethoscope } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/utils'
import { NewProcedureForm } from './new-procedure-form'
import { ProcedureRowActions } from './procedure-row-actions'
import { TussTableBadge, type TussTable } from './tuss-table-badge'

export const dynamic = 'force-dynamic'

interface JoinedRow {
  id: string
  tuss_code: string | null
  display_name: string | null
  active: boolean
  created_at: string
  default_amount_cents: number | null
  covered_by_plan: boolean
  is_unlisted: boolean
  custom_code_id: string | null
  custom_table_id: string | null
  tuss_codes: { description: string; tuss_table: string; manufacturer: string | null } | null
  custom_procedure_codes: { code: string; description: string } | null
  custom_procedure_tables: { name: string } | null
}

export default async function ProcedimentosPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  const [{ data: rawRows, error }, { data: tablesData }] = await Promise.all([
    supabase
      .from('procedures')
      .select(
        'id, tuss_code, display_name, active, created_at, default_amount_cents, covered_by_plan, is_unlisted, custom_code_id, custom_table_id, ' +
          'tuss_codes!procedures_tuss_code_fkey(description, tuss_table, manufacturer), ' +
          'custom_procedure_codes:custom_code_id(code, description), ' +
          'custom_procedure_tables:custom_table_id(name)',
      )
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('custom_procedure_tables' as never)
      .select('id, name')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
  ])
  const rows = (rawRows ?? []) as unknown as JoinedRow[]
  const customTables = ((tablesData ?? []) as unknown as Array<{ id: string; name: string }>) ?? []
  const combinedError = error

  const canWrite = can(session.role, 'procedure.write')
  const activeCount = rows.filter((r) => r.active).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Procedimentos</h1>
        <p className="mt-1 text-sm text-slate-500">
          {rows.length} procedimento{rows.length === 1 ? '' : 's'} cadastrado{rows.length === 1 ? '' : 's'} ·{' '}
          <span className="font-semibold text-slate-700">{activeCount} ativo{activeCount === 1 ? '' : 's'}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
        {canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Stethoscope className="h-4 w-4 text-primary" />
                Novo procedimento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <NewProcedureForm customTables={customTables} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-3 p-8 text-sm text-slate-500">
              <ListChecks className="h-6 w-6 text-slate-300" />
              <p>
                Seu perfil tem acesso somente de leitura aos procedimentos. Peça ao administrador
                para cadastrar novos itens.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cadastrados</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {combinedError ? (
              <p className="px-6 pb-6 text-sm text-rose-600">Erro: {combinedError.message}</p>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <ListChecks className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-500">
                  Nenhum procedimento cadastrado ainda.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TUSS</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Cobertura / Particular</TableHead>
                    <TableHead>Cadastrado</TableHead>
                    <TableHead>Status</TableHead>
                    {canWrite ? <TableHead className="text-right" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs font-bold text-primary">
                        {r.is_unlisted ? (
                          <div className="flex flex-col items-start gap-1">
                            {r.custom_procedure_codes ? (
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="secondary"
                                  className="border-violet-200 bg-violet-50 text-[10px] text-violet-800"
                                >
                                  Personalizado
                                </Badge>
                                <span>{r.custom_procedure_codes.code}</span>
                              </div>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="border-amber-200 bg-amber-50 text-[10px] text-amber-800"
                              >
                                Não listado
                              </Badge>
                            )}
                            {r.custom_procedure_tables ? (
                              <Badge
                                variant="outline"
                                className="border-sky-200 bg-sky-50 text-[9px] font-bold text-sky-800"
                              >
                                {r.custom_procedure_tables.name}
                              </Badge>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            {r.tuss_codes?.tuss_table ? (
                              <TussTableBadge table={r.tuss_codes.tuss_table as TussTable} />
                            ) : null}
                            <span>{r.tuss_code}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="font-semibold text-slate-900">
                          {r.display_name || r.tuss_codes?.description || '—'}
                        </p>
                        {r.display_name && r.tuss_codes?.description ? (
                          <p className="text-[11px] text-slate-500">{r.tuss_codes.description}</p>
                        ) : null}
                        {r.tuss_codes?.manufacturer ? (
                          <p className="text-[11px] text-slate-400">{r.tuss_codes.manufacturer}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-[11px]">
                          <Badge
                            variant={r.covered_by_plan ? 'secondary' : 'outline'}
                            className={r.covered_by_plan ? '' : 'border-amber-300 text-amber-700'}
                          >
                            {r.covered_by_plan ? 'Coberto por planos' : 'Particular'}
                          </Badge>
                          <span className="text-slate-500">
                            Part.:{' '}
                            <span className="font-bold tabular-nums text-slate-700">
                              {r.default_amount_cents !== null
                                ? formatCurrency(r.default_amount_cents)
                                : '—'}
                            </span>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-700">{formatDate(r.created_at)}</TableCell>
                      <TableCell>
                        {r.active ? (
                          <Badge variant="success">Ativo</Badge>
                        ) : (
                          <Badge variant="secondary">Inativo</Badge>
                        )}
                      </TableCell>
                      {canWrite ? (
                        <TableCell className="text-right">
                          <ProcedureRowActions
                            procedureId={r.id}
                            active={r.active}
                            displayName={r.display_name}
                            defaultAmountCents={r.default_amount_cents}
                            coveredByPlan={r.covered_by_plan}
                            codeLabel={
                              r.is_unlisted
                                ? r.custom_procedure_codes?.code ?? 'não listado'
                                : r.tuss_code ?? '—'
                            }
                          />
                        </TableCell>
                      ) : null}
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
