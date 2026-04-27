import { redirect } from 'next/navigation'
import { TrendingDown, Activity, CreditCard, CalendarDays } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { can } from '@/lib/auth/rbac'
import { listExpenses } from '@/lib/core/expenses/list'
import { formatCurrency, formatDate } from '@/lib/utils'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NewExpenseForm } from './new-expense-form'
import { SoftDeleteExpenseButton } from './soft-delete-button'

export const dynamic = 'force-dynamic'

type ExpenseCategory =
  | 'aluguel'
  | 'equipamentos'
  | 'materiais'
  | 'pessoal'
  | 'servicos'
  | 'impostos'
  | 'manutencao'
  | 'outros'

interface DespesasPageProps {
  searchParams: {
    category?: string
  }
}

const VALID_CATEGORIES = new Set([
  'aluguel',
  'equipamentos',
  'materiais',
  'pessoal',
  'servicos',
  'impostos',
  'manutencao',
  'outros',
])

export default async function DespesasPage({ searchParams }: DespesasPageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'expense.read')) redirect('/operacao/atendimentos')

  const category =
    searchParams.category && VALID_CATEGORIES.has(searchParams.category)
      ? (searchParams.category as ExpenseCategory)
      : 'all'

  const supabase = createSupabaseServiceClient()
  const expenses = await listExpenses(supabase, {
    tenantId: session.tenantId,
    category,
  })

  const canWrite = can(session.role, 'expense.write')
  const canDelete = session.role === 'admin'

  const totalAmount = expenses.reduce((acc, curr) => acc + Number(curr.amount_cents), 0)
  const avgAmount = expenses.length > 0 ? Math.round(totalAmount / expenses.length) : 0
  const recurringCount = expenses.filter((e) => e.recurring).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Despesas</h1>
        <p className="mt-1 text-sm text-slate-500">
          {expenses.length} lançamento{expenses.length === 1 ? '' : 's'} ·{' '}
          {recurringCount} recorrente{recurringCount === 1 ? '' : 's'} · total{' '}
          <span className="font-semibold text-slate-800">{formatCurrency(totalAmount)}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Saída total"
          value={formatCurrency(totalAmount)}
          icon={<TrendingDown className="h-4 w-4" />}
        />
        <StatCard
          label="Ticket médio"
          value={formatCurrency(avgAmount)}
          icon={<CreditCard className="h-4 w-4" />}
        />
        <StatCard
          label="Recorrentes"
          value={`${recurringCount} / ${expenses.length}`}
          icon={<CalendarDays className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
        {canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4 text-primary" />
                Nova despesa
              </CardTitle>
            </CardHeader>
            <CardContent>
              <NewExpenseForm />
              <p className="mt-3 text-[11px] text-slate-500">
                Lançamentos são imutáveis por gatilho de banco. Apenas soft-delete é permitido
                (admin) e aparece na trilha de auditoria.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-8 text-sm text-slate-500">
              Seu perfil tem acesso somente de leitura às despesas.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm">Lançamentos</CardTitle>
            <form method="GET" className="flex items-center gap-2">
              <Select name="category" defaultValue={category}>
                <SelectTrigger className="w-40 h-8 text-xs">
                  <SelectValue placeholder="Todas as categorias" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  <SelectItem value="aluguel">Aluguel</SelectItem>
                  <SelectItem value="equipamentos">Equipamentos</SelectItem>
                  <SelectItem value="materiais">Materiais</SelectItem>
                  <SelectItem value="pessoal">Pessoal</SelectItem>
                  <SelectItem value="servicos">Serviços</SelectItem>
                  <SelectItem value="impostos">Impostos</SelectItem>
                  <SelectItem value="manutencao">Manutenção</SelectItem>
                  <SelectItem value="outros">Outros</SelectItem>
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
          <CardContent className="p-0">
            {expenses.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <TrendingDown className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-500">
                  Nenhuma despesa no filtro atual.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Competência</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((e) => (
                    <TableRow key={e.id} className="group">
                      <TableCell>
                        <p className="font-semibold text-slate-900">
                          {formatDate(e.competence_date)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={categoryBadge(e.category)}>
                          {e.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-slate-900">{e.description}</p>
                        {e.supplier ? (
                          <p className="text-[11px] text-slate-500">
                            Fornecedor: {e.supplier}
                          </p>
                        ) : null}
                        {e.recurring ? (
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                            Recorrente · {e.frequency}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900 tabular-nums">
                        {formatCurrency(e.amount_cents)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canDelete ? <SoftDeleteExpenseButton id={e.id} /> : null}
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

function StatCard(props: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="rounded-lg bg-slate-50 p-2 text-slate-500">{props.icon}</div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {props.label}
          </p>
          <p className="text-lg font-bold tabular-nums text-slate-900">{props.value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function categoryBadge(cat: string): string {
  const map: Record<string, string> = {
    aluguel: 'bg-indigo-50 text-indigo-700',
    equipamentos: 'bg-amber-50 text-amber-700',
    materiais: 'bg-emerald-50 text-emerald-700',
    pessoal: 'bg-blue-50 text-blue-700',
    servicos: 'bg-rose-50 text-rose-700',
    impostos: 'bg-purple-50 text-purple-700',
    manutencao: 'bg-orange-50 text-orange-700',
    outros: 'bg-slate-100 text-slate-700',
  }
  return map[cat] ?? map.outros!
}
