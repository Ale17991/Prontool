import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Download, Filter, ScrollText } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'
import { entityToLabel } from '@/lib/utils/audit-labels'

export const dynamic = 'force-dynamic'

const ENTITY_OPTIONS = [
  'price_versions',
  'procedures',
  'health_plans',
  'doctors',
  'doctor_commission_history',
  'appointments',
  'appointment_reversals',
  'patients',
  'clinical_records',
] as const

const PAGE_SIZE = 100

interface PageProps {
  searchParams: {
    entity?: string
    result?: 'success' | 'denied' | 'conflict'
    from?: string
    to?: string
    cursor?: string
  }
}

interface AuditRow {
  id: string | null
  timestamp_utc: string | null
  actor_label: string | null
  entity: string | null
  entity_id: string | null
  field: string | null
  old_value: string | null
  new_value: string | null
  reason: string | null
  result: string | null
  ip: string | null
}

export default async function AuditoriaPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'audit.read')) redirect('/operacao/atendimentos')

  const supabase = createSupabaseServerClient()
  let q = supabase
    .from('audit_log')
    .select(
      'id, timestamp_utc, actor_label, entity, entity_id, field, old_value, new_value, reason, result, ip',
    )
    .order('timestamp_utc', { ascending: false })
    .limit(PAGE_SIZE + 1)

  if (searchParams.entity) q = q.eq('entity', searchParams.entity)
  if (searchParams.result) q = q.eq('result', searchParams.result)
  if (searchParams.from) q = q.gte('timestamp_utc', searchParams.from)
  if (searchParams.to) q = q.lte('timestamp_utc', searchParams.to)
  if (searchParams.cursor) q = q.lt('timestamp_utc', searchParams.cursor)

  const { data: rawRows, error } = await q
  const rows = (rawRows ?? []) as AuditRow[]
  const hasMore = rows.length > PAGE_SIZE
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.timestamp_utc : null

  const exportQs = buildExportQs(searchParams)

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Auditoria</h1>
          <p className="mt-1 text-sm text-slate-500">
            Trilha append-only de mudanças financeiras e acessos. Os campos exportados
            preservam o formato original conforme FR-019.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/auditoria/export?format=csv${exportQs}`}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <Download className="h-3 w-3" />
            CSV
          </a>
          <a
            href={`/api/auditoria/export?format=json${exportQs}`}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <Download className="h-3 w-3" />
            JSON
          </a>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4 text-primary" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="entity" className="text-xs">
                Entidade
              </Label>
              <select
                id="entity"
                name="entity"
                defaultValue={searchParams.entity ?? ''}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Todas</option>
                {ENTITY_OPTIONS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="result" className="text-xs">
                Resultado
              </Label>
              <select
                id="result"
                name="result"
                defaultValue={searchParams.result ?? ''}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Todos</option>
                <option value="success">Sucesso</option>
                <option value="denied">Negado</option>
                <option value="conflict">Conflito</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from" className="text-xs">
                De
              </Label>
              <Input id="from" name="from" type="date" defaultValue={searchParams.from} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to" className="text-xs">
                Até
              </Label>
              <Input id="to" name="to" type="date" defaultValue={searchParams.to} />
            </div>
            <Button type="submit">Aplicar</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="px-6 py-8 text-sm text-rose-600">Erro: {error.message}</p>
          ) : pageRows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <ScrollText className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                Nenhum evento encontrado nos filtros.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Ator</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Campo</TableHead>
                  <TableHead>Mudança</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow key={r.id ?? Math.random()} className="align-top">
                    <TableCell className="whitespace-nowrap text-slate-700">
                      {formatDateTime(r.timestamp_utc)}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-slate-500">
                      {r.actor_label ?? '—'}
                    </TableCell>
                    <TableCell>
                      <p className="font-semibold text-slate-900">{entityToLabel(r.entity)}</p>
                      {r.entity_id ? (
                        <p className="font-mono text-[10px] text-slate-400">
                          {r.entity_id.slice(0, 8)}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">{r.field ?? '—'}</TableCell>
                    <TableCell className="max-w-sm text-[11px]">
                      <div className="space-y-1">
                        {r.old_value ? (
                          <p className="text-rose-600">
                            <span className="font-bold">−</span>{' '}
                            <span className="font-mono break-words">{r.old_value}</span>
                          </p>
                        ) : null}
                        {r.new_value ? (
                          <p className="text-emerald-700">
                            <span className="font-bold">+</span>{' '}
                            <span className="font-mono break-words">{r.new_value}</span>
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-slate-600">
                      {r.reason ?? '—'}
                    </TableCell>
                    <TableCell>
                      <ResultBadge result={r.result} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {nextCursor ? (
        <div className="flex justify-end">
          <Link
            href={`/configuracoes/auditoria${buildPageQs(searchParams, nextCursor)}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Carregar mais
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function ResultBadge({ result }: { result: string | null }) {
  if (result === 'denied') return <Badge variant="destructive">Negado</Badge>
  if (result === 'conflict') return <Badge variant="warning">Conflito</Badge>
  if (result === 'success') return <Badge variant="success">OK</Badge>
  return <Badge variant="secondary">—</Badge>
}

function buildExportQs(sp: PageProps['searchParams']): string {
  const usp = new URLSearchParams()
  if (sp.entity) usp.set('entity', sp.entity)
  if (sp.result) usp.set('result', sp.result)
  if (sp.from) usp.set('from', sp.from)
  if (sp.to) usp.set('to', sp.to)
  const s = usp.toString()
  return s ? `&${s}` : ''
}

function buildPageQs(sp: PageProps['searchParams'], cursor: string): string {
  const usp = new URLSearchParams()
  if (sp.entity) usp.set('entity', sp.entity)
  if (sp.result) usp.set('result', sp.result)
  if (sp.from) usp.set('from', sp.from)
  if (sp.to) usp.set('to', sp.to)
  usp.set('cursor', cursor)
  const s = usp.toString()
  return s ? `?${s}` : ''
}
