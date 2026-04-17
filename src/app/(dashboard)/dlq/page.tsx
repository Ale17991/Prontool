import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { ReprocessButton } from './reprocess-button'

export const dynamic = 'force-dynamic'

// supabase-js types the Insert side of views with `never` for computed
// columns, which poisons the inferred Row shape when TS falls back to
// the second overload. A narrow DTO captures what the view actually
// returns for this page without fighting the generated types.
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
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Dead Letter Queue</h1>
      <p style={{ color: '#64748b', marginBottom: 16, fontSize: 14 }}>
        Eventos do GHL que falharam no processamento e aguardam intervenção.
      </p>

      {error ? (
        <p style={{ color: '#b91c1c' }}>Erro: {error.message}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#64748b' }}>Nenhum evento na fila.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={thStyle}>Recebido</th>
              <th style={thStyle}>GHL Event ID</th>
              <th style={thStyle}>Motivo</th>
              <th style={thStyle}>Resumo do payload</th>
              <th style={thStyle}>Tentativas</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #e2e8f0', verticalAlign: 'top' }}>
                <td style={tdStyle}>
                  {r.received_at ? new Date(r.received_at).toLocaleString('pt-BR') : '—'}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>
                  {r.ghl_event_id}
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      background: '#fee2e2',
                      color: '#991b1b',
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 12,
                    }}
                  >
                    {r.failure_reason ?? 'unknown'}
                  </span>
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, maxWidth: 320 }}>
                  {renderPayloadSummary(r.payload)}
                </td>
                <td style={tdStyle}>{r.processing_attempt_count ?? 0}</td>
                <td style={tdStyle}>
                  {canReprocess && r.id ? <ReprocessButton rawEventId={r.id} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 }
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 12,
  color: '#475569',
  fontWeight: 600,
}
const tdStyle: React.CSSProperties = { padding: '8px 10px' }
