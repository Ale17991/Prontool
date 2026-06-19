import Link from 'next/link'
import { redirect } from 'next/navigation'
import { TrendingDown, Activity, CreditCard, CalendarDays, Paperclip, Calculator, Download } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { can } from '@/lib/auth/rbac'
import { listExpenses } from '@/lib/core/expenses/list'
import {
  countReceiptsByExpense,
  listReceiptsForExpense,
} from '@/lib/core/expenses/list-receipts'
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
import { ReceiptList, type ReceiptItem } from './receipt-list'
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

  const receiptCounts = await countReceiptsByExpense(supabase, {
    tenantId: session.tenantId,
    expenseIds: expenses.map((e) => e.id),
  })
  const receiptsByExpense = new Map<string, ReceiptItem[]>()
  await Promise.all(
    expenses.map(async (e) => {
      if ((receiptCounts.get(e.id) ?? 0) === 0) {
        receiptsByExpense.set(e.id, [])
        return
      }
      const list = await listReceiptsForExpense(supabase, {
        tenantId: session.tenantId,
        expenseId: e.id,
      })
      receiptsByExpense.set(
        e.id,
        list.map((r) => ({
          id: r.id,
          file_name: r.fileName,
          storage_path: r.storagePath,
          file_size_bytes: r.fileSizeBytes,
          content_type: r.contentType,
          uploaded_at: r.uploadedAt,
          uploaded_by: r.uploadedBy,
        })),
      )
    }),
  )

  const totalAmount = expenses.reduce((acc, curr) => acc + Number(curr.amount_cents), 0)
  const avgAmount = expenses.length > 0 ? Math.round(totalAmount / expenses.length) : 0
  const recurringCount = expenses.filter((e) => e.recurring).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Despesas</h1>
          <p className="mt-1 text-sm text-slate-500">
            {expenses.length} lançamento{expenses.length === 1 ? '' : 's'} ·{' '}
            {recurringCount} recorrente{recurringCount === 1 ? '' : 's'} · total{' '}
            <span className="font-semibold text-slate-800">{formatCurrency(totalAmount)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/despesas/export/excel${category !== 'all' ? `?category=${category}` : ''}`}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" /> Excel
          </a>
          <a
            href={`/api/despesas/export/pdf${category !== 'all' ? `?category=${category}` : ''}`}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" /> PDF
          </a>
          <Link
            href="/analise/despesas/impostos"
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Calculator className="h-3.5 w-3.5" /> Impostos cadastrados
          </Link>
        </div>
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
                    <TableHead className="text-right">Comprovante</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((e) => {
                    const receiptCount = receiptCounts.get(e.id) ?? 0
                    const receipts = receiptsByExpense.get(e.id) ?? []
                    return (
                      <TableRow key={e.id} className="group align-top">
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
                          {(e as { tax_name?: string | null }).tax_name ? (
                            <p className="text-[11px] font-semibold text-[#6B21A8]">
                              Imposto: {(e as { tax_name?: string | null }).tax_name}
                            </p>
                          ) : null}
                          {e.recurring ? (
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-info-text">
                              Recorrente · {e.frequency}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-bold text-slate-900 tabular-nums">
                          {formatCurrency(e.amount_cents)}
                        </TableCell>
                        <TableCell className="min-w-[260px]">
                          <details className="group/receipts">
                            <summary className="flex cursor-pointer list-none items-center justify-end gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900">
                              <Paperclip className="h-3 w-3" />
                              {receiptCount > 0 ? (
                                <span>{receiptCount}</span>
                              ) : (
                                <span className="italic text-slate-400">
                                  {canWrite ? 'anexar' : 'sem'}
                                </span>
                              )}
                            </summary>
                            <div className="mt-2">
                              <ReceiptList
                                expenseId={e.id}
                                initialReceipts={receipts}
                                canWrite={canWrite}
                                canDelete={canDelete}
                              />
                            </div>
                          </details>
                        </TableCell>
                        <TableCell className="text-right">
                          {canDelete ? <SoftDeleteExpenseButton id={e.id} /> : null}
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

// 016 — categorias de despesa harmonizadas com paleta do designer onde
// fazem sentido semantico. Categorias sem match natural (indigo/purple/
// orange) mantem Tailwind defaults para preservar diferenciacao visual.
function categoryBadge(cat: string): string {
  const map: Record<string, string> = {
    aluguel: 'bg-indigo-50 text-indigo-700',
    equipamentos: 'bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning-foreground))]',
    materiais: 'bg-success-bg text-success-text',
    pessoal: 'bg-info-bg text-info-text',
    servicos: 'bg-destructive/10 text-destructive',
    impostos: 'bg-[#FAF5FF] text-[#6B21A8]',
    manutencao: 'bg-orange-50 text-orange-700',
    outros: 'bg-slate-100 text-slate-700',
  }
  return map[cat] ?? map.outros!
}
