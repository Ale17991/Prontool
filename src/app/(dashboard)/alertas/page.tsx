import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { ResolveButton } from './resolve-button'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: {
    status?: 'aberto' | 'resolvido' | 'todos'
  }
}

interface AlertRow {
  id: string | null
  type: string | null
  status: string | null
  detail: unknown
  created_at: string | null
}

export default async function AlertasPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  const statusFilter = searchParams.status ?? 'aberto'

  const supabase = createSupabaseServerClient()
  let query = supabase
    .from('alerts')
    .select('id, type, status, detail, subject_ref, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (statusFilter !== 'todos') query = query.eq('status', statusFilter)

  const { data: rawRows, error } = await query
  const rows = (rawRows ?? []) as AlertRow[]
  const canResolve = can(session.role, 'alert.resolve')

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Alertas</h1>
      <form method="get" style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <label style={{ display: 'grid', fontSize: 12, color: '#475569' }}>
          Status
          <select name="status" defaultValue={statusFilter} style={inputStyle}>
            <option value="aberto">Abertos</option>
            <option value="resolvido">Resolvidos</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        <button type="submit" style={buttonStyle}>
          Filtrar
        </button>
      </form>

      {error ? (
        <p style={{ color: '#b91c1c' }}>Erro: {error.message}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#64748b' }}>Nenhum alerta.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={thStyle}>Quando</th>
              <th style={thStyle}>Tipo</th>
              <th style={thStyle}>Detalhe</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #e2e8f0', verticalAlign: 'top' }}>
                <td style={tdStyle}>
                  {r.created_at ? new Date(r.created_at).toLocaleString('pt-BR') : '—'}
                </td>
                <td style={tdStyle}>{r.type}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>
                  {renderDetailSummary(r.detail)}
                </td>
                <td style={tdStyle}>{r.status}</td>
                <td style={tdStyle}>
                  {canResolve && r.status === 'aberto' && r.id ? (
                    <ResolveButton alertId={r.id} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
}
const buttonStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: '#2563eb',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  alignSelf: 'end',
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
