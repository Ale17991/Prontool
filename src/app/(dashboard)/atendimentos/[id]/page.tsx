import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Calendar, DollarSign, History, Percent, Receipt } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBps, formatCurrency, formatDateTime } from '@/lib/utils'
import { ReversalForm } from './reversal-form'

export const dynamic = 'force-dynamic'

interface AppointmentDetail {
  id: string | null
  appointment_at: string | null
  frozen_amount_cents: number | null
  frozen_commission_bps: number | null
  net_amount_cents: number | null
  net_commission_cents: number | null
  effective_status: string | null
  reversal_id: string | null
  reversed_at: string | null
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
      'id, appointment_at, frozen_amount_cents, frozen_commission_bps, net_amount_cents, net_commission_cents, effective_status, reversal_id, reversed_at',
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/atendimentos"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-3 w-3" /> Voltar para atendimentos
          </Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
            Atendimento
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-400">{appointment.id}</p>
        </div>
        {status === 'estornado' ? (
          <Badge variant="destructive" className="self-start">
            Estornado
          </Badge>
        ) : (
          <Badge variant="success" className="self-start">
            Ativo
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <SummaryCard
          icon={Calendar}
          label="Data do atendimento"
          value={formatDateTime(appointment.appointment_at)}
        />
        <SummaryCard
          icon={DollarSign}
          label="Valor congelado"
          value={formatCurrency(appointment.frozen_amount_cents)}
        />
        <SummaryCard
          icon={Percent}
          label="Comissão congelada"
          value={formatBps(appointment.frozen_commission_bps)}
        />
        <SummaryCard
          icon={Receipt}
          label="Valor líquido"
          value={formatCurrency(appointment.net_amount_cents)}
          accent={status === 'estornado'}
        />
      </div>

      {canReverse && appointment.id ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrar reversão</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-slate-500">
              Insere um registro compensatório negativo. O atendimento original é preservado, e
              a operação fica registrada na trilha de auditoria.
            </p>
            <ReversalForm appointmentId={appointment.id} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-primary" />
            Histórico de auditoria
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {audit.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">Nenhum evento de auditoria.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Ator</TableHead>
                  <TableHead>Campo</TableHead>
                  <TableHead>De</TableHead>
                  <TableHead>Para</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-slate-700">
                      {formatDateTime(row.timestamp_utc)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {row.actor_label ?? '—'}
                    </TableCell>
                    <TableCell>{row.field ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{row.old_value ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{row.new_value ?? '—'}</TableCell>
                    <TableCell>{row.reason ?? '—'}</TableCell>
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

interface SummaryCardProps {
  icon: typeof Calendar
  label: string
  value: string
  accent?: boolean
}

function SummaryCard({ icon: Icon, label, value, accent }: SummaryCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-3 inline-flex rounded-xl border border-blue-100 bg-blue-50 p-2.5 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p
          className={
            accent
              ? 'text-xl font-black tracking-tight text-rose-600'
              : 'text-xl font-black tracking-tight text-slate-900'
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
