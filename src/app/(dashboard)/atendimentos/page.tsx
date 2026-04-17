import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: {
    from?: string
    to?: string
    status?: 'ativo' | 'estornado' | 'todos'
  }
}

interface AppointmentRow {
  id: string | null
  appointment_at: string | null
  frozen_amount_cents: number | null
  frozen_commission_bps: number | null
  net_amount_cents: number | null
  net_commission_cents: number | null
  effective_status: string | null
}

export default async function AtendimentosPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  let query = supabase
    .from('appointments_effective')
    .select(
      'id, appointment_at, frozen_amount_cents, frozen_commission_bps, net_amount_cents, net_commission_cents, effective_status',
    )
    .order('appointment_at', { ascending: false })
    .limit(200)

  if (searchParams.from) query = query.gte('appointment_at', searchParams.from)
  if (searchParams.to) query = query.lte('appointment_at', searchParams.to)
  const statusFilter = searchParams.status ?? 'todos'
  if (statusFilter !== 'todos') query = query.eq('effective_status', statusFilter)

  const { data: rawRows, error } = await query
  const rows = (rawRows ?? []) as AppointmentRow[]

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Atendimentos</h1>
      <form
        method="get"
        style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'end' }}
      >
        <Field label="De" name="from" type="date" defaultValue={searchParams.from} />
        <Field label="Até" name="to" type="date" defaultValue={searchParams.to} />
        <label style={{ display: 'grid', fontSize: 12, color: '#475569' }}>
          Status
          <select name="status" defaultValue={statusFilter} style={inputStyle}>
            <option value="todos">Todos</option>
            <option value="ativo">Ativos</option>
            <option value="estornado">Estornados</option>
          </select>
        </label>
        <button type="submit" style={buttonStyle}>
          Filtrar
        </button>
      </form>

      {error ? (
        <p style={{ color: '#b91c1c' }}>Erro ao carregar: {error.message}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#64748b' }}>Nenhum atendimento encontrado no período.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={thStyle}>Data</th>
              <th style={thStyle}>Valor</th>
              <th style={thStyle}>Comissão</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={tdStyle}>
                  {r.appointment_at
                    ? new Date(r.appointment_at).toLocaleString('pt-BR')
                    : '—'}
                </td>
                <td style={tdStyle}>{formatCents(r.net_amount_cents ?? r.frozen_amount_cents)}</td>
                <td style={tdStyle}>
                  {formatCents(r.net_commission_cents ?? computeCommission(r))}
                </td>
                <td style={tdStyle}>
                  <StatusBadge status={r.effective_status ?? 'ativo'} />
                </td>
                <td style={tdStyle}>
                  {r.id ? (
                    <Link href={`/atendimentos/${r.id}`} style={linkStyle}>
                      Abrir
                    </Link>
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

function StatusBadge({ status }: { status: string }) {
  const bg = status === 'estornado' ? '#fee2e2' : '#dcfce7'
  const fg = status === 'estornado' ? '#991b1b' : '#166534'
  return (
    <span style={{ background: bg, color: fg, padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>
      {status}
    </span>
  )
}

function Field({
  label,
  name,
  type,
  defaultValue,
}: {
  label: string
  name: string
  type: string
  defaultValue: string | undefined
}) {
  return (
    <label style={{ display: 'grid', fontSize: 12, color: '#475569' }}>
      {label}
      <input name={name} type={type} defaultValue={defaultValue} style={inputStyle} />
    </label>
  )
}

function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function computeCommission(row: {
  frozen_amount_cents: number | null
  frozen_commission_bps: number | null
}): number | null {
  if (row.frozen_amount_cents === null || row.frozen_commission_bps === null) return null
  return Math.round((row.frozen_amount_cents * row.frozen_commission_bps) / 10_000)
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
}
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
}
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontWeight: 600,
  fontSize: 12,
  color: '#475569',
}
const tdStyle: React.CSSProperties = { padding: '8px 10px' }
const linkStyle: React.CSSProperties = { color: '#2563eb', textDecoration: 'none' }
