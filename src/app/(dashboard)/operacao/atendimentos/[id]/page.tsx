import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  ClipboardList,
  Clock,
  DollarSign,
  History,
  Percent,
  Receipt,
  ShieldAlert,
  Stethoscope,
  User,
} from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBps, formatCurrency, formatDateTime } from '@/lib/utils'
import { listAllergies, type PatientAllergyDTO } from '@/lib/core/patient-medical/allergies'
import {
  listAppointmentMaterials,
  type AppointmentMaterial,
} from '@/lib/core/appointments/materials'
import { ReversalForm } from './reversal-form'
import { MarkRealizedForm } from './mark-realized-form'

export const dynamic = 'force-dynamic'

interface AppointmentDetail {
  id: string | null
  patient_id: string | null
  doctor_id: string | null
  plan_id: string | null
  appointment_at: string | null
  duration_minutes: number | null
  observacoes: string | null
  frozen_amount_cents: number | null
  frozen_commission_bps: number | null
  net_amount_cents: number | null
  net_commission_cents: number | null
  effective_status: string | null
  reversal_id: string | null
  reversed_at: string | null
  procedures: { tuss_code: string; display_name: string | null } | null
  doctors: { full_name: string | null } | null
  health_plans: { name: string | null } | null
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

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const appointment = await loadAppointmentDetail(supabase, params.id)
  if (!appointment) notFound()

  // Nome do paciente (descriptografado em batch).
  let patientName = '—'
  const encryptionKey = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (appointment.patient_id && encryptionKey) {
    const service = createSupabaseServiceClient()
    const { data } = await service.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: session.tenantId,
      p_patient_ids: [appointment.patient_id],
      p_key: encryptionKey,
    })
    type DecryptRow = { id: string; full_name: string | null; anonymized_at: string | null }
    const dec = ((data ?? []) as DecryptRow[])[0]
    if (dec) patientName = dec.anonymized_at ? '[anonimizado]' : dec.full_name ?? '—'
  }

  // Alergias do paciente (Card de destaque).
  let allergies: PatientAllergyDTO[] = []
  if (appointment.patient_id) {
    try {
      allergies = await listAllergies(supabase, {
        tenantId: session.tenantId,
        patientId: appointment.patient_id,
      })
    } catch {
      // best-effort — nao bloqueia render do detalhe
    }
  }

  // Materiais utilizados (feature 007). Best-effort — render vazia
  // se a migration 0061 ainda nao aplicou.
  let materials: AppointmentMaterial[] = []
  if (appointment.id) {
    try {
      materials = await listAppointmentMaterials(supabase, {
        appointmentId: appointment.id,
        tenantId: session.tenantId,
      })
    } catch {
      // ignore — sub-bloco nao renderiza
    }
  }

  const { data: auditRaw } = await supabase
    .from('audit_log')
    .select('timestamp_utc, actor_label, field, old_value, new_value, reason, result')
    .eq('entity', 'appointments')
    .eq('entity_id', params.id)
    .order('timestamp_utc', { ascending: true })
  const audit = (auditRaw ?? []) as AuditRow[]

  // Fallback de seguranca: ambientes sem a migration 0054 retornam apenas
  // 'ativo'/'estornado'. Calculamos 'agendado' por timestamp para que o
  // detalhe funcione em qualquer estado do schema.
  const rawStatus = appointment.effective_status ?? 'ativo'
  const isFuture =
    appointment.appointment_at !== null &&
    new Date(appointment.appointment_at).getTime() > Date.now()
  const status =
    rawStatus === 'estornado'
      ? 'estornado'
      : rawStatus === 'agendado' || isFuture
        ? 'agendado'
        : 'ativo'
  const canReverse = can(session.role, 'appointment.reverse') && status !== 'estornado'

  // Hora fim derivada de inicio + duracao.
  const endIso = appointment.appointment_at
    ? new Date(
        new Date(appointment.appointment_at).getTime() +
          (appointment.duration_minutes ?? 30) * 60_000,
      ).toISOString()
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
            <Link href="/operacao/atendimentos">
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar
            </Link>
          </Button>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900">
            Atendimento
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-400">{appointment.id}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {status === 'estornado' ? (
            <Badge variant="destructive" className="self-start">
              Cancelado
            </Badge>
          ) : status === 'agendado' ? (
            <Badge
              variant="secondary"
              className="self-start border-sky-200 bg-sky-50 text-sky-800"
            >
              Agendado
            </Badge>
          ) : (
            <Badge variant="success" className="self-start">
              Ativo
            </Badge>
          )}
          {appointment.plan_id === null ? (
            <Badge
              variant="secondary"
              className="self-start border-amber-200 bg-amber-50 text-amber-800"
            >
              Particular
            </Badge>
          ) : null}
        </div>
      </div>

      {/* ---- Dados clínicos (foco principal) ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="h-4 w-4 text-primary" />
            Dados clínicos
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ClinicalRow icon={Calendar} label="Início">
            {formatDateTime(appointment.appointment_at)}
          </ClinicalRow>
          <ClinicalRow icon={Clock} label="Fim">
            {endIso ? formatDateTime(endIso) : '—'}
          </ClinicalRow>
          <ClinicalRow icon={User} label="Paciente">
            <span className="font-bold">{patientName}</span>
          </ClinicalRow>
          <ClinicalRow icon={Stethoscope} label="Profissional">
            {appointment.doctors?.full_name ?? '—'}
          </ClinicalRow>
          <ClinicalRow icon={ClipboardList} label="Procedimento">
            {formatProcedure(appointment.procedures)}
          </ClinicalRow>
          <ClinicalRow icon={ClipboardList} label="Observações">
            {appointment.observacoes?.trim() ? (
              <span className="whitespace-pre-wrap">{appointment.observacoes}</span>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </ClinicalRow>
        </CardContent>
      </Card>

      {/* ---- Card de destaque: alergias do paciente ---- */}
      <AllergiesCard allergies={allergies} />

      {materials.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Materiais utilizados</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {materials.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50/40 px-2.5 py-1.5 text-xs"
                >
                  <span className="font-mono font-bold text-slate-900">{m.tussCode}</span>
                  <span className="min-w-0 flex-1 text-slate-700">{m.tussDescription}</span>
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] text-slate-700">
                    Qtd {m.quantity}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {status === 'agendado' && appointment.id &&
        (session.role === 'admin' || session.role === 'profissional_saude') ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confirmar atendimento</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-slate-500">
              Confirma que o atendimento foi realizado. A etapa vinculada do plano de
              tratamento (se houver) é marcada como concluída automaticamente.
            </p>
            <MarkRealizedForm appointmentId={appointment.id} />
          </CardContent>
        </Card>
      ) : null}

      {canReverse && appointment.id ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cancelar atendimento</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-slate-500">
              Registra o cancelamento. O atendimento original é preservado e a
              operação fica registrada no histórico.
            </p>
            <ReversalForm appointmentId={appointment.id} />
          </CardContent>
        </Card>
      ) : null}

      {/* ---- Dados financeiros (colapsável, no final) ---- */}
      <details className="group rounded-lg border border-slate-200 bg-white">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-slate-700">
          <span className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-slate-400" />
            Dados financeiros
          </span>
          <span className="text-xs font-medium text-slate-400 group-open:hidden">
            mostrar
          </span>
          <span className="hidden text-xs font-medium text-slate-400 group-open:inline">
            ocultar
          </span>
        </summary>
        <div className="border-t border-slate-100 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <ClinicalRow icon={DollarSign} label="Valor congelado">
              {formatCurrency(appointment.frozen_amount_cents)}
            </ClinicalRow>
            <ClinicalRow icon={Percent} label="Comissão congelada">
              {formatBps(appointment.frozen_commission_bps)}
            </ClinicalRow>
            <ClinicalRow icon={Receipt} label="Valor líquido">
              <span
                className={
                  status === 'estornado' ? 'font-black text-rose-600' : 'font-black'
                }
              >
                {formatCurrency(appointment.net_amount_cents)}
              </span>
            </ClinicalRow>
            <ClinicalRow icon={Stethoscope} label="Plano">
              {appointment.health_plans?.name ?? '—'}
            </ClinicalRow>
          </div>
        </div>
      </details>

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

/**
 * Carrega o detalhe do atendimento de `appointments_effective` com fallback
 * gracioso para colunas opcionais que podem nao existir em todos os ambientes:
 *   - `observacoes` (introduzida na feature 005)
 *   - `duration_minutes` (introduzida na migration 0053)
 *
 * Em vez de falhar com 500, dropa cada coluna ausente e tenta de novo.
 */
async function loadAppointmentDetail(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<AppointmentDetail | null> {
  const baseColumns =
    'id, patient_id, doctor_id, plan_id, appointment_at, ' +
    'frozen_amount_cents, frozen_commission_bps, net_amount_cents, net_commission_cents, ' +
    'effective_status, reversal_id, reversed_at, ' +
    'procedures:procedure_id(tuss_code, display_name), ' +
    'doctors:doctor_id(full_name), ' +
    'health_plans:plan_id(name)'

  // Tenta com todas as colunas opcionais; cai gradativamente.
  const attempts: Array<{ select: string; opt: { duration: boolean; obs: boolean } }> = [
    {
      select: `${baseColumns}, duration_minutes, observacoes`,
      opt: { duration: true, obs: true },
    },
    { select: `${baseColumns}, duration_minutes`, opt: { duration: true, obs: false } },
    { select: `${baseColumns}, observacoes`, opt: { duration: false, obs: true } },
    { select: baseColumns, opt: { duration: false, obs: false } },
  ]

  for (const attempt of attempts) {
    const result = await supabase
      .from('appointments_effective')
      .select(attempt.select)
      .eq('id', id)
      .maybeSingle()
    if (!result.error) {
      if (!result.data) return null
      const row = result.data as unknown as Record<string, unknown>
      return {
        id: (row.id as string | null) ?? null,
        patient_id: (row.patient_id as string | null) ?? null,
        doctor_id: (row.doctor_id as string | null) ?? null,
        plan_id: (row.plan_id as string | null) ?? null,
        appointment_at: (row.appointment_at as string | null) ?? null,
        duration_minutes: attempt.opt.duration
          ? ((row.duration_minutes as number | null) ?? null)
          : null,
        observacoes: attempt.opt.obs ? ((row.observacoes as string | null) ?? null) : null,
        frozen_amount_cents: (row.frozen_amount_cents as number | null) ?? null,
        frozen_commission_bps: (row.frozen_commission_bps as number | null) ?? null,
        net_amount_cents: (row.net_amount_cents as number | null) ?? null,
        net_commission_cents: (row.net_commission_cents as number | null) ?? null,
        effective_status: (row.effective_status as string | null) ?? null,
        reversal_id: (row.reversal_id as string | null) ?? null,
        reversed_at: (row.reversed_at as string | null) ?? null,
        procedures: (row.procedures as AppointmentDetail['procedures']) ?? null,
        doctors: (row.doctors as AppointmentDetail['doctors']) ?? null,
        health_plans: (row.health_plans as AppointmentDetail['health_plans']) ?? null,
      }
    }
    if (
      isMissingColumnError(result.error.message, 'observacoes') ||
      isMissingColumnError(result.error.message, 'duration_minutes')
    ) {
      continue
    }
    throw new Error(`appointment read failed: ${result.error.message}`)
  }
  throw new Error('appointment read failed: no compatible select')
}

function isMissingColumnError(message: string, column: string): boolean {
  if (!message) return false
  const lower = message.toLowerCase()
  const col = column.toLowerCase()
  return (
    lower.includes(`column ${col}`) ||
    lower.includes(`"${col}" does not exist`) ||
    (lower.includes(col) && lower.includes('does not exist'))
  )
}

function formatProcedure(
  procedure: { tuss_code: string; display_name: string | null } | null,
): string {
  if (!procedure) return '—'
  if (procedure.display_name) return `${procedure.tuss_code} · ${procedure.display_name}`
  return procedure.tuss_code
}

function ClinicalRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Calendar
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <div className="mt-0.5 text-sm text-slate-700">{children}</div>
      </div>
    </div>
  )
}

function AllergiesCard({ allergies }: { allergies: PatientAllergyDTO[] }) {
  if (allergies.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent className="flex items-center gap-3 p-4">
          <ShieldAlert className="h-5 w-5 text-emerald-600" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
              Alergias do paciente
            </p>
            <p
              className="text-sm font-bold text-emerald-900"
              title="NKDA — No Known Drug Allergies"
            >
              Sem alergias conhecidas
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const grave = allergies.filter((a) => a.severity === 'grave').length
  const accent = grave > 0 ? 'rose' : 'amber'

  return (
    <Card
      className={
        accent === 'rose'
          ? 'border-rose-200 bg-rose-50/40'
          : 'border-amber-200 bg-amber-50/40'
      }
    >
      <CardHeader className="pb-2">
        <CardTitle
          className={
            accent === 'rose'
              ? 'flex items-center gap-2 text-sm text-rose-900'
              : 'flex items-center gap-2 text-sm text-amber-900'
          }
        >
          <AlertTriangle
            className={accent === 'rose' ? 'h-4 w-4 text-rose-600' : 'h-4 w-4 text-amber-600'}
          />
          Alergias do paciente — {allergies.length} registrada
          {allergies.length === 1 ? '' : 's'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {allergies.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-xs">
            <Badge
              variant={a.severity === 'grave' ? 'destructive' : 'secondary'}
              className={
                a.severity === 'grave'
                  ? ''
                  : a.severity === 'moderada'
                    ? 'border-amber-300 bg-amber-100 text-amber-900'
                    : 'border-slate-300 bg-slate-100 text-slate-700'
              }
            >
              {a.severity}
            </Badge>
            <span className="font-bold text-slate-900">{a.substance}</span>
            {a.notes ? <span className="text-slate-600">— {a.notes}</span> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
