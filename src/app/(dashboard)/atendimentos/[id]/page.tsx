import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { ReversalForm } from './reversal-form'

export const dynamic = 'force-dynamic'

interface AppointmentDetail {
  id: string | null
  appointment_at: string | null
  frozen_amount_cents: number | null
  frozen_commission_bps: number | null
  net_amount_cents: number | null
  effective_status: string | null
}

interface AuditRow {
  timestamp_utc: string | null
  actor_label: string | null
  field: string | null
  old_value: string | null
  new_value: string | null
  reason: string | null
  result: string | null
}

export default async function AtendimentoDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = createSupabaseServerClient()
  const { data: appointmentRaw, error } = await supabase
    .from('appointments_effective')
    .select(
      'id, appointment_at, frozen_amount_cents, frozen_commission_bps, net_amount_cents, effective_status',
    )
    .eq('id', params.id)
    .maybeSingle()
  const appointment = appointmentRaw as AppointmentDetail | null

  if (error) throw new Error(`appointment read failed: ${error.message}`)
  if (!appointment) notFound()

  const { data: auditRaw } = await supabase
    .from('audit_log')
    .select('timestamp_utc, actor_label, field, old_value, new_value, reason, result')
    .eq('entity', 'appointments')
    .eq('entity_id', params.id)
    .order('timestamp_utc', { ascending: true })
  const audit = (auditRaw ?? []) as AuditRow[]

  const status = appointment.effective_status ?? 'ativo'
  const canReverse = can(session.role, 'appointment.reverse') && status === 'ativo'

  return (
    <div>
      <a href="/atendimentos" style={{ color: '#2563eb', fontSize: 14 }}>
        ← Atendimentos
      </a>
      <h1 style={{ fontSize: 24, marginTop: 8, marginBottom: 16 }}>Atendimento</h1>

      <section style={sectionStyle}>
        <Row label="Data" value={formatDate(appointment.appointment_at)} />
        <Row
          label="Valor congelado"
          value={formatCents(appointment.frozen_amount_cents)}
        />
        <Row
          label="Comissão congelada"
          value={`${((appointment.frozen_commission_bps ?? 0) / 100).toFixed(2)}%`}
        />
        <Row label="Status" value={status} />
        <Row label="Valor líquido" value={formatCents(appointment.net_amount_cents)} />
        <Row label="Atendimento" value={appointment.id ?? '—'} mono />
      </section>

      {canReverse && appointment.id ? (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>Registrar reversão</h2>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
            A reversão insere um registro compensatório negativo e preserva o histórico.
          </p>
          <ReversalForm appointmentId={appointment.id} />
        </section>
      ) : null}

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Histórico de auditoria</h2>
        {!audit || audit.length === 0 ? (
          <p style={{ color: '#64748b' }}>Nenhum evento de auditoria.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={thStyle}>Quando</th>
                <th style={thStyle}>Ator</th>
                <th style={thStyle}>Campo</th>
                <th style={thStyle}>De</th>
                <th style={thStyle}>Para</th>
                <th style={thStyle}>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((row, idx) => (
                <tr key={idx} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={tdStyle}>{formatDate(row.timestamp_utc)}</td>
                  <td style={tdStyle}>{row.actor_label ?? '—'}</td>
                  <td style={tdStyle}>{row.field ?? '—'}</td>
                  <td style={tdStyle}>{row.old_value ?? '—'}</td>
                  <td style={tdStyle}>{row.new_value ?? '—'}</td>
                  <td style={tdStyle}>{row.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', padding: '6px 0' }}>
      <div style={{ color: '#475569', fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 14, fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  )
}

function formatDate(v: string | null | undefined): string {
  if (!v) return '—'
  return new Date(v).toLocaleString('pt-BR')
}

function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const sectionStyle: React.CSSProperties = {
  background: '#f8fafc',
  padding: 16,
  borderRadius: 6,
  border: '1px solid #e2e8f0',
}
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 12,
  color: '#475569',
  fontWeight: 600,
}
const tdStyle: React.CSSProperties = { padding: '8px 10px' }
