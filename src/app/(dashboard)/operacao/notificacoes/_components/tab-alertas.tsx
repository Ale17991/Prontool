import { Bell, Filter } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import type { TenantRole } from '@/lib/db/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'
import { ResolveButton } from '../../alertas/resolve-button'

/**
 * Feature 014 — US2 — sub-seção "Alertas do sistema" da página unificada.
 * Conteúdo idêntico ao que vivia em /operacao/alertas/page.tsx antes da
 * reorganização; só foi extraído pra um componente. Filtro por status via
 * `?status=` é repassado via form GET (preserva ?tab=alertas).
 */

type StatusFilter = 'aberto' | 'resolvido' | 'todos'

interface Props {
  role: TenantRole
  statusFilter: StatusFilter
}

interface AlertRow {
  id: string | null
  type: string | null
  status: string | null
  detail: unknown
  created_at: string | null
}

const TYPE_LABEL: Record<string, string> = {
  dlq_event: 'Pendência de integração',
  webhook_rejected: 'Evento rejeitado pela integração',
  tuss_deprecated: 'TUSS descontinuado',
  signature_failure: 'Assinatura inválida',
  rbac_denied: 'Acesso negado',
}

export async function TabAlertas({ role, statusFilter }: Props) {
  const supabase = createSupabaseServerClient()
  let query = supabase
    .from('alerts')
    .select('id, type, status, detail, subject_ref, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (statusFilter !== 'todos') query = query.eq('status', statusFilter)

  const { data: rawRows, error } = await query
  const rows = (rawRows ?? []) as AlertRow[]
  const canResolve = can(role, 'alert.resolve')

  const openCount = rows.filter((r) => r.status === 'aberto').length

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        {rows.length} alerta{rows.length === 1 ? '' : 's'}
        {statusFilter === 'aberto'
          ? ' abertos'
          : statusFilter === 'resolvido'
            ? ' resolvidos'
            : ''}
        {statusFilter === 'todos' && openCount > 0 ? ` · ${openCount} abertos` : ''}
      </p>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-primary" />
            Filtro
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-wrap items-end gap-3">
            {/* Preservamos ?tab=alertas para a aba não trocar ao submeter o filtro. */}
            <input type="hidden" name="tab" value="alertas" />
            <div className="space-y-1.5">
              <Label htmlFor="status" className="text-xs">
                Status
              </Label>
              <select
                id="status"
                name="status"
                defaultValue={statusFilter}
                className="flex h-9 w-44 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="aberto">Abertos</option>
                <option value="resolvido">Resolvidos</option>
                <option value="todos">Todos</option>
              </select>
            </div>
            <Button type="submit">Filtrar</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="px-6 py-8 text-sm text-destructive">Erro: {error.message}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <Bell className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                Nenhum alerta no filtro atual.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Detalhe</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id ?? Math.random()} className="align-top">
                    <TableCell className="text-slate-700">
                      {formatDateTime(r.created_at)}
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-slate-900">
                        {TYPE_LABEL[r.type ?? ''] ?? r.type}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {renderDetailSummary(r.detail)}
                    </TableCell>
                    <TableCell>
                      {r.status === 'aberto' ? (
                        <Badge variant="warning">Aberto</Badge>
                      ) : (
                        <Badge variant="secondary">Resolvido</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canResolve && r.status === 'aberto' && r.id ? (
                        <ResolveButton alertId={r.id} />
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
  )
}

function renderDetailSummary(detail: unknown): string {
  if (!detail || typeof detail !== 'object') return '—'
  const obj = detail as Record<string, unknown>
  const keys = ['failure_reason', 'raw_event_id', 'tuss_code', 'plan_name', 'ghl_event_id']
  const parts: string[] = []
  for (const k of keys) if (typeof obj[k] === 'string') parts.push(`${k}=${obj[k] as string}`)
  if (parts.length === 0) return JSON.stringify(obj).slice(0, 80)
  return parts.join(' · ')
}
