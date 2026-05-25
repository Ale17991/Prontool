import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  ClipboardList,
  Clock,
  DollarSign,
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
import { listAssistantsByAppointment } from '@/lib/core/appointment-assistants/list-by-appointment'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import {
  AppointmentStatusBadge,
  effectiveStatusToVariant,
} from '@/components/ui/appointment-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBps, formatCurrency, formatDateTime } from '@/lib/utils'
import { listAllergies, type PatientAllergyDTO } from '@/lib/core/patient-medical/allergies'
import {
  listAppointmentMaterials,
  type AppointmentMaterial,
} from '@/lib/core/appointments/materials'
import {
  listAppointmentProcedures,
  type AppointmentProcedureLine,
} from '@/lib/core/appointments/procedures'
import { ReversalForm } from './reversal-form'
import { MarkRealizedForm } from './mark-realized-form'
import { ConfirmAppointmentButton } from './confirm-button'
import { CancelAppointmentForm } from './cancel-form'

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

  // Procedimentos (feature multi-procedimento — 0069). Best-effort.
  let procedureLines: AppointmentProcedureLine[] = []
  if (appointment.id) {
    try {
      procedureLines = await listAppointmentProcedures(supabase, {
        appointmentId: appointment.id,
        tenantId: session.tenantId,
      })
    } catch {
      // ignore — fallback para o procedimento singular legado
    }
  }

  // Assistentes (feature 013 US2). Best-effort — render vazia se a
  // migration 0084 ainda nao aplicou.
  let assistantsActive: Array<{
    id: string
    doctorName: string
    doctorSpecialty: string | null
    frozenAmountCents: number
  }> = []
  let assistantsRemovedCount = 0
  if (appointment.id) {
    try {
      const res = await listAssistantsByAppointment(supabase, {
        appointmentId: appointment.id,
        tenantId: session.tenantId,
      })
      assistantsActive = res.active.map((a) => ({
        id: a.id,
        doctorName: a.doctorName,
        doctorSpecialty: a.doctorSpecialty,
        frozenAmountCents: a.frozenAmountCents,
      }))
      assistantsRemovedCount = res.removedCount
    } catch {
      // ignore — sub-bloco nao renderiza
    }
  }

  // Resolve effective_status com prioridade no valor do banco. O heuristico
  // isFuture so e usado quando rawStatus nao bate em um dos estados
  // conhecidos (legacy / pre-0054). Isso evita que um atendimento ja
  // realizado em data futura seja reportado erroneamente como 'agendado'.
  const KNOWN_STATUSES = ['agendado', 'confirmado', 'ativo', 'cancelado', 'estornado'] as const
  const rawStatus = appointment.effective_status ?? ''
  const isFuture =
    appointment.appointment_at !== null &&
    new Date(appointment.appointment_at).getTime() > Date.now()
  const status: (typeof KNOWN_STATUSES)[number] = (
    KNOWN_STATUSES as readonly string[]
  ).includes(rawStatus)
    ? (rawStatus as (typeof KNOWN_STATUSES)[number])
    : isFuture
      ? 'agendado'
      : 'ativo'
  const canReverse = can(session.role, 'appointment.reverse') && status === 'ativo'
  const canManageSchedule =
    session.role === 'admin' ||
    session.role === 'recepcionista' ||
    session.role === 'profissional_saude'
  // Card unico progressivo: 'agendado' -> mostra Confirmar agendamento;
  // 'confirmado' -> mostra Confirmar presenca; demais -> esconde o card.
  const canProgressSchedule =
    (status === 'agendado' || status === 'confirmado') &&
    (session.role === 'admin' ||
      session.role === 'recepcionista' ||
      session.role === 'profissional_saude')
  // Cancelar agendamento: permitido em todo estado nao-terminal de
  // cancelamento. Em 'ativo' o RPC cria o estorno financeiro
  // automaticamente (no-show de atendimento ja registrado).
  const canCancelSchedule =
    (status === 'agendado' ||
      status === 'confirmado' ||
      status === 'ativo' ||
      status === 'estornado') &&
    canManageSchedule

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
          <AppointmentStatusBadge
            variant={effectiveStatusToVariant(status)}
            className="self-start"
          />
          {appointment.plan_id === null ? (
            <Badge variant="warning" className="self-start">
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
            {appointment.patient_id ? (
              <Link
                href={`/operacao/pacientes/${appointment.patient_id}`}
                className="font-bold text-link hover:text-link-hover hover:underline"
              >
                {patientName}
              </Link>
            ) : (
              <span className="font-bold">{patientName}</span>
            )}
          </ClinicalRow>
          <ClinicalRow icon={Stethoscope} label="Profissional">
            <div>
              <p>{appointment.doctors?.full_name ?? '—'}</p>
              {assistantsActive.length > 0 ? (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Assistentes
                  </p>
                  <ul className="space-y-0.5 text-xs text-slate-700">
                    {assistantsActive.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2">
                        <span>
                          {a.doctorName}
                          {a.doctorSpecialty ? (
                            <span className="text-slate-400"> · {a.doctorSpecialty}</span>
                          ) : null}
                        </span>
                        <span className="font-mono font-semibold">
                          {formatCurrency(a.frozenAmountCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {assistantsRemovedCount > 0 ? (
                    <p className="text-[10px] text-slate-400">
                      + {assistantsRemovedCount} assistente
                      {assistantsRemovedCount === 1 ? '' : 's'} removido
                      {assistantsRemovedCount === 1 ? '' : 's'} historicamente
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </ClinicalRow>
          <ClinicalRow icon={ClipboardList} label="Procedimento">
            {procedureLines.length > 1 ? (
              `${procedureLines.length} procedimentos (ver lista abaixo)`
            ) : procedureLines.length === 1 ? (
              <span>
                {formatProcedure(appointment.procedures)}
                {procedureLines[0]!.quantity > 1 ? (
                  <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-700">
                    ×{procedureLines[0]!.quantity}
                  </span>
                ) : null}
              </span>
            ) : (
              formatProcedure(appointment.procedures)
            )}
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

      {procedureLines.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Procedimentos ({procedureLines.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead className="w-28">TUSS</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead className="w-14 text-center">Qtd</TableHead>
                  <TableHead className="text-right">Valor unit.</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {procedureLines.map((line) => {
                  const qty = line.quantity || 1
                  const subtotal = line.lineAmountCents * qty
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="text-xs text-slate-500">{line.sequence}</TableCell>
                      <TableCell className="font-mono text-xs font-bold">
                        {line.procedureTussCode ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {line.procedureDisplayName ?? '(sem nome)'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {line.planId === null ? (
                          <span className="rounded bg-[hsl(var(--warning)/0.15)] px-1.5 py-0.5 text-[hsl(var(--warning-foreground))]">
                            Particular
                          </span>
                        ) : (
                          line.planName ?? '—'
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs tabular-nums">
                        {qty > 1 ? (
                          <span className="font-bold text-slate-900">×{qty}</span>
                        ) : (
                          <span className="text-slate-400">1</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatCurrency(line.lineAmountCents)}
                        {line.amountWasOverridden ? (
                          <span
                            className="ml-1 text-[10px] text-[hsl(var(--warning-foreground))]"
                            title={`Vigente: ${formatCurrency(line.vigenteAmountCents)}`}
                          >
                            ★
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                        {formatCurrency(subtotal)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

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

      {canProgressSchedule && appointment.id ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {status === 'agendado'
                ? 'Confirmar agendamento'
                : 'Confirmar presença (atendimento realizado)'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status === 'agendado' ? (
              <>
                <p className="mb-4 text-sm text-slate-500">
                  Marca que o paciente avisou que vai comparecer (confirmação
                  prévia). Não significa que o atendimento já foi realizado.
                </p>
                <ConfirmAppointmentButton appointmentId={appointment.id} />
              </>
            ) : (
              <>
                <p className="mb-4 text-sm text-slate-500">
                  Registra que o paciente compareceu e o atendimento foi
                  realizado. A etapa vinculada do plano de tratamento (se
                  houver) é marcada como concluída automaticamente e o
                  atendimento passa a entrar nos faturamentos.
                </p>
                <MarkRealizedForm appointmentId={appointment.id} />
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {canCancelSchedule && appointment.id ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cancelar atendimento</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-slate-500">
              {status === 'ativo'
                ? 'Cancela o atendimento já realizado e reverte automaticamente o impacto financeiro. Use para registrar no-show ou desmarcação tardia.'
                : status === 'confirmado'
                  ? 'Cancela o atendimento confirmado pelo paciente. Como o paciente já tinha assumido compromisso, o impacto financeiro é estornado automaticamente.'
                  : status === 'estornado'
                    ? 'O atendimento foi estornado financeiramente. Registre o motivo de cancelamento da agenda (ex.: paciente não compareceu).'
                    : 'Cancela o agendamento e libera o horário do profissional para reagendar. Como o atendimento estava apenas agendado, não gera estorno.'}
            </p>
            <CancelAppointmentForm appointmentId={appointment.id} />
          </CardContent>
        </Card>
      ) : null}

      {canReverse && appointment.id ? (
        <details className="group rounded-lg border border-slate-200 bg-white">
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-slate-700">
            <span>Estornar atendimento (sem cancelar agenda)</span>
            <span className="text-xs font-medium text-slate-400 group-open:hidden">
              mostrar
            </span>
            <span className="hidden text-xs font-medium text-slate-400 group-open:inline">
              ocultar
            </span>
          </summary>
          <div className="border-t border-slate-100 p-4">
            <p className="mb-4 text-sm text-slate-500">
              Use apenas para correções puramente financeiras (cobrança duplicada,
              erro de valor) onde o atendimento aconteceu de fato. Para no-show
              ou desmarcação use &quot;Cancelar atendimento&quot; acima — ele já
              cuida do estorno automaticamente.
            </p>
            <ReversalForm appointmentId={appointment.id} />
          </div>
        </details>
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
                  status === 'estornado' ? 'font-black text-destructive' : 'font-black'
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
      <Card className="border-success/30 bg-success-bg/60">
        <CardContent className="flex items-center gap-3 p-4">
          <ShieldAlert className="h-5 w-5 text-success-strong" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-success-strong">
              Alergias do paciente
            </p>
            <p
              className="text-sm font-bold text-success-text"
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
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-warning/30 bg-[hsl(var(--warning)/0.05)]'
      }
    >
      <CardHeader className="pb-2">
        <CardTitle
          className={
            accent === 'rose'
              ? 'flex items-center gap-2 text-sm text-destructive'
              : 'flex items-center gap-2 text-sm text-[hsl(var(--warning-foreground))]'
          }
        >
          <AlertTriangle
            className={
              accent === 'rose'
                ? 'h-4 w-4 text-destructive'
                : 'h-4 w-4 text-warning'
            }
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
                    ? 'border-warning/40 bg-[hsl(var(--warning)/0.2)] text-[hsl(var(--warning-foreground))]'
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
