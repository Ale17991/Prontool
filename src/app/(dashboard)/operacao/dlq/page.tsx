import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'
import { ReprocessButton } from './reprocess-button'

export const dynamic = 'force-dynamic'

interface DlqRow {
  id: string | null
  ghl_event_id: string | null
  received_at: string | null
  failure_reason: string | null
  payload: unknown
  processing_attempt_count: number | null
}

export default async function DlqPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: rawRows, error } = await supabase
    .from('dlq_events')
    .select('id, ghl_event_id, received_at, failure_reason, payload, processing_attempt_count')
    .order('received_at', { ascending: false })
    .limit(200)
  const rows = (rawRows ?? []) as DlqRow[]

  const canReprocess = can(session.role, 'dlq.reprocess')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Fila de erros</h1>
        <p className="mt-1 text-sm text-slate-500">
          Eventos do GHL que falharam no processamento e aguardam intervenção manual.
          {rows.length > 0 ? (
            <>
              {' '}
              <span className="font-semibold text-slate-700">
                {rows.length} evento{rows.length === 1 ? '' : 's'} pendente{rows.length === 1 ? '' : 's'}.
              </span>
            </>
          ) : null}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="px-6 py-8 text-sm text-rose-600">Erro: {error.message}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <AlertTriangle className="h-8 w-8 text-emerald-300" />
              <p className="text-sm font-medium text-slate-500">
                Nenhum evento na fila — ingestão saudável.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recebido</TableHead>
                  <TableHead>GHL Event ID</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Resumo do payload</TableHead>
                  <TableHead>Tentativas</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id ?? Math.random()} className="align-top">
                    <TableCell className="text-slate-700">{formatDateTime(r.received_at)}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {r.ghl_event_id ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="destructive">{r.failure_reason ?? 'unknown'}</Badge>
                    </TableCell>
                    <TableCell className="max-w-sm">
                      <span className="block break-words font-mono text-xs text-slate-600">
                        {renderPayloadSummary(r.payload)}
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-700">
                      {r.processing_attempt_count ?? 0}
                    </TableCell>
                    <TableCell className="text-right">
                      {canReprocess && r.id ? <ReprocessButton rawEventId={r.id} /> : null}
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

function renderPayloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '—'
  const p = payload as Record<string, unknown>
  const bits: string[] = []
  if (typeof p['event_id'] === 'string') bits.push(`event=${p['event_id']}`)
  if (typeof p['event_type'] === 'string') bits.push(`type=${p['event_type']}`)
  const contact = p['contact'] as Record<string, unknown> | undefined
  if (contact && typeof contact['id'] === 'string') bits.push(`contact=${contact['id']}`)
  return bits.join(' · ') || JSON.stringify(payload).slice(0, 120)
}
