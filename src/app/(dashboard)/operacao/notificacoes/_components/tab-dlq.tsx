import { AlertTriangle } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import type { TenantRole } from '@/lib/db/types'
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
import { formatDateTime } from '@/lib/utils'
import { ReprocessButton } from '../../dlq/reprocess-button'

/**
 * Feature 014 — US2 — sub-seção "Pendências" da página unificada. Conteúdo
 * idêntico ao /operacao/dlq/page.tsx pré-feature; só foi extraído pra um
 * componente.
 */

interface Props {
  role: TenantRole
}

interface DlqRow {
  id: string | null
  ghl_event_id: string | null
  received_at: string | null
  failure_reason: string | null
  payload: unknown
  processing_attempt_count: number | null
}

export async function TabDlq({ role }: Props) {
  const supabase = createSupabaseServerClient()
  const { data: rawRows, error } = await supabase
    .from('dlq_events')
    .select('id, ghl_event_id, received_at, failure_reason, payload, processing_attempt_count')
    .order('received_at', { ascending: false })
    .limit(200)
  const rows = (rawRows ?? []) as DlqRow[]

  const canReprocess = can(role, 'dlq.reprocess')

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Eventos da integração que falharam no processamento e aguardam revisão.
        {rows.length > 0 ? (
          <>
            {' '}
            <span className="font-semibold text-slate-700">
              {rows.length} evento{rows.length === 1 ? '' : 's'} pendente
              {rows.length === 1 ? '' : 's'}.
            </span>
          </>
        ) : null}
      </p>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="px-6 py-8 text-sm text-destructive">Erro: {error.message}</p>
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
                  <TableHead>Homio Event ID</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Resumo do payload</TableHead>
                  <TableHead>Tentativas</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id ?? Math.random()} className="align-top">
                    <TableCell className="text-slate-700">
                      {formatDateTime(r.received_at)}
                    </TableCell>
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
