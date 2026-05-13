import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Calculator, CheckCircle2, XCircle } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { can } from '@/lib/auth/rbac'
import { listTaxes } from '@/lib/core/taxes/list'
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
import { NewTaxForm } from './new-tax-form'
import { TaxRowActions } from './tax-row-actions'

export const dynamic = 'force-dynamic'

const CATEGORY_LABEL: Record<string, string> = {
  municipal: 'Municipal',
  estadual: 'Estadual',
  federal: 'Federal',
  outro: 'Outro',
}

export default async function ImpostosPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'tax.read')) redirect('/operacao/atendimentos')

  const supabase = createSupabaseServiceClient()
  const taxes = await listTaxes(supabase, {
    tenantId: session.tenantId,
    includeInactive: true,
  })

  const canWrite = can(session.role, 'tax.write')
  const activeCount = taxes.filter((t) => t.is_active).length
  const inactiveCount = taxes.length - activeCount

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/analise/despesas"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para despesas
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Impostos</h1>
        <p className="mt-1 text-sm text-slate-500">
          {taxes.length} cadastrado{taxes.length === 1 ? '' : 's'} · {activeCount} ativo
          {activeCount === 1 ? '' : 's'} · {inactiveCount} inativo
          {inactiveCount === 1 ? '' : 's'}. Cadastre os impostos a que a clínica está
          sujeita (ISS, IRPJ, CSLL, etc.). Use para classificar despesas e consolidar
          carga tributária em relatórios.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
        {canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Calculator className="h-4 w-4 text-primary" />
                Novo imposto
              </CardTitle>
            </CardHeader>
            <CardContent>
              <NewTaxForm />
              <p className="mt-3 text-[11px] text-slate-500">
                Nome e categoria são imutáveis após o cadastro (preserva integridade
                da trilha de auditoria). Alíquota pode ser editada; desativação é
                reversível.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-8 text-sm text-slate-500">
              Seu perfil tem acesso somente de leitura aos impostos.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Impostos cadastrados</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {taxes.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <Calculator className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-500">
                  Nenhum imposto cadastrado ainda.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead className="text-right">Alíquota</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxes.map((t) => (
                    <TableRow key={t.id} className="group">
                      <TableCell>
                        <p className="font-bold text-slate-900">{t.name}</p>
                        {t.description ? (
                          <p className="text-[11px] text-slate-500">{t.description}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums text-slate-900">
                        {t.rate_percent} %
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={categoryBadge(t.category)}>
                          {CATEGORY_LABEL[t.category] ?? t.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {t.is_active ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" /> Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                            <XCircle className="h-3 w-3" /> Inativo
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canWrite ? (
                          <TaxRowActions
                            id={t.id}
                            name={t.name}
                            ratePercent={t.rate_percent}
                            description={t.description}
                            isActive={t.is_active}
                          />
                        ) : null}
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

function categoryBadge(cat: string): string {
  const map: Record<string, string> = {
    municipal: 'bg-blue-50 text-blue-700',
    estadual: 'bg-amber-50 text-amber-700',
    federal: 'bg-purple-50 text-purple-700',
    outro: 'bg-slate-100 text-slate-700',
  }
  return map[cat] ?? map.outro!
}
