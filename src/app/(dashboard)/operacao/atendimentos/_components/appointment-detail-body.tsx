'use client'

import Link from 'next/link'
import {
  AlertTriangle,
  Calendar,
  ClipboardList,
  Clock,
  DollarSign,
  Percent,
  Pill,
  Receipt,
  ShieldAlert,
  Stethoscope,
  User,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  AppointmentStatusBadge,
  effectiveStatusToVariant,
} from '@/components/ui/appointment-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatBps, formatCurrency, formatDateTime } from '@/lib/utils'
import { can } from '@/lib/auth/rbac'
import type { TenantRole } from '@/lib/db/types'
import type { PatientAllergyDTO } from '@/lib/core/patient-medical/allergies'
import { ReversalForm } from '../[id]/reversal-form'
import { MarkRealizedForm } from '../[id]/mark-realized-form'
import { ConfirmAppointmentButton } from '../[id]/confirm-button'
import { CancelAppointmentForm } from '../[id]/cancel-form'
import { PrescreverLauncher } from '../[id]/prescrever-launcher'
import { TissGuiaLauncher } from '../[id]/tiss-guia-launcher'
import { ProcedureParticipants } from './procedure-participants'
import { AppointmentAttachmentsSection } from './appointment-attachments-section'
import { AppointmentScansSection } from './appointment-scans-section'
import type { AppointmentDetailDTO } from './types'

/**
 * Render puro do detalhe do atendimento — reusa o JSX da página
 * standalone (`[id]/page.tsx`) sem fetch interno. Forms de ação
 * recebem `onSuccess={refetch}` para que o painel re-busque os dados
 * após confirmar/cancelar/estornar.
 *
 * IMPORTANTE — guards de visibilidade por role (Constitution V):
 * preservamos os mesmos cálculos `canReverse`, `canProgressSchedule`,
 * `canCancelSchedule` da página standalone (linhas 178–198 originais).
 * UI esconde botões; a autorização real continua server-side nos
 * endpoints `/api/atendimentos/[id]/{confirmar,cancelar,realizado,reversal}`.
 */
interface Props {
  data: AppointmentDetailDTO
  role: TenantRole
  refetch: () => void
  onDirtyChange?: (dirty: boolean) => void
  onPendingChange?: (pending: boolean) => void
}

const KNOWN_STATUSES = ['agendado', 'confirmado', 'ativo', 'cancelado', 'estornado'] as const

export function AppointmentDetailBody({
  data,
  role,
  refetch,
  onDirtyChange,
  onPendingChange,
}: Props) {
  const { appointment, patient, procedures, materials, allergies, assistants, assistantsRemovedCount } = data
  const prescriberReady = data.memed?.prescriberReady ?? false
  const prescriptions = data.prescriptions ?? []

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

  const canReverse = can(role, 'appointment.reverse') && status === 'ativo'
  // Guia TISS: só para atendimentos de convênio (não particular) já realizados,
  // por admin/financeiro. A elegibilidade fina (operadora habilitada, carteira,
  // CBO) é validada server-side ao gerar.
  const canGenerateTiss =
    (role === 'admin' || role === 'financeiro') &&
    status === 'ativo' &&
    appointment.plan_id !== null
  // Ver VALORES (recepção fora — só vê valor no registro do atendimento).
  const canViewValues = can(role, 'finance.view_values')
  const canManageSchedule =
    role === 'admin' || role === 'recepcionista' || role === 'profissional_saude'
  const canProgressSchedule =
    (status === 'agendado' || status === 'confirmado') && canManageSchedule
  const canCancelSchedule =
    (status === 'agendado' ||
      status === 'confirmado' ||
      status === 'ativo' ||
      status === 'estornado') &&
    canManageSchedule

  const endIso = appointment.appointment_at
    ? new Date(
        new Date(appointment.appointment_at).getTime() +
          (appointment.duration_minutes ?? 30) * 60_000,
      ).toISOString()
    : null

  const patientName = patient.name

  return (
    <div className="space-y-6">
      {/* Header (sem botão "Voltar" — Sheet tem X) */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-900">Atendimento</h2>
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

      {/* ---- Dados clínicos ---- */}
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
              {assistants.length > 0 ? (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Assistentes
                  </p>
                  <ul className="space-y-0.5 text-xs text-slate-700">
                    {assistants.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2">
                        <span>
                          {a.doctorName}
                          {a.doctorSpecialty ? (
                            <span className="text-slate-400"> · {a.doctorSpecialty}</span>
                          ) : null}
                        </span>
                        <span className="font-mono font-semibold">
                          {canViewValues ? formatCurrency(a.frozenAmountCents) : '—'}
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
            {procedures.length > 1 ? (
              `${procedures.length} procedimentos (ver lista abaixo)`
            ) : procedures.length === 1 ? (
              <span>
                {formatProcedure(appointment.procedures)}
                {procedures[0]!.quantity > 1 ? (
                  <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-700">
                    ×{procedures[0]!.quantity}
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

      {/* ---- Alergias ---- */}
      <AllergiesCard allergies={allergies} />

      {prescriberReady && appointment.id && appointment.doctor_id ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Pill className="h-4 w-4 text-primary" />
              Prescrição digital
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-slate-500">
              Abre a prescrição digital da Memed com o paciente já carregado.
            </p>
            <PrescreverLauncher
              appointmentId={appointment.id}
              doctorId={appointment.doctor_id}
              onRecorded={refetch}
            />
          </CardContent>
        </Card>
      ) : null}

      {canGenerateTiss && appointment.id ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Receipt className="h-4 w-4 text-primary" />
              Faturamento TISS
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-slate-500">
              Gera a Guia de Consulta TISS deste atendimento para faturar ao convênio.
            </p>
            <TissGuiaLauncher appointmentId={appointment.id} onRecorded={refetch} />
          </CardContent>
        </Card>
      ) : null}

      {prescriptions.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardList className="h-4 w-4 text-primary" />
              Prescrições ({prescriptions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-xs">
              {prescriptions.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-slate-600">#{p.memed_prescription_id}</span>
                  <span className="ml-auto text-slate-500">{formatDateTime(p.issued_at)}</span>
                  {p.status === 'deleted' ? (
                    <Badge variant="secondary">Excluída</Badge>
                  ) : (
                    <Badge variant="success">Emitida</Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {procedures.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Procedimentos ({procedures.length})
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
                {procedures.map((line) => {
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
                        {canViewValues ? formatCurrency(line.lineAmountCents) : '—'}
                        {canViewValues && line.amountWasOverridden ? (
                          <span
                            className="ml-1 text-[10px] text-[hsl(var(--warning-foreground))]"
                            title={`Vigente: ${formatCurrency(line.vigenteAmountCents)}`}
                          >
                            ★
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                        {canViewValues ? formatCurrency(subtotal) : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {appointment.id ? (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <ProcedureParticipants
                  appointmentId={appointment.id}
                  procedures={procedures.map((line) => ({
                    id: line.id,
                    label: line.procedureDisplayName
                      ? `${line.procedureTussCode ?? ''} · ${line.procedureDisplayName}`.trim()
                      : (line.procedureTussCode ?? `Procedimento ${line.sequence}`),
                  }))}
                  canManage={role === 'admin' || role === 'financeiro'}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {appointment.id ? (
        <Card>
          <CardContent className="pt-6">
            <AppointmentAttachmentsSection
              appointmentId={appointment.id}
              canManage={
                role === 'admin' || role === 'recepcionista' || role === 'profissional_saude'
              }
            />
          </CardContent>
        </Card>
      ) : null}

      {appointment.id ? (
        <Card>
          <CardContent className="pt-6">
            <AppointmentScansSection
              appointmentId={appointment.id}
              canManage={role === 'admin' || role === 'profissional_saude'}
            />
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
                  Marca que o paciente avisou que vai comparecer (confirmação prévia).
                  Não significa que o atendimento já foi realizado.
                </p>
                <ConfirmAppointmentButton
                  appointmentId={appointment.id}
                  onSuccess={refetch}
                  onPendingChange={onPendingChange}
                />
              </>
            ) : (
              <>
                <p className="mb-4 text-sm text-slate-500">
                  Registra que o paciente compareceu e o atendimento foi realizado.
                  A etapa vinculada do plano de tratamento (se houver) é marcada como
                  concluída automaticamente e o atendimento passa a entrar nos
                  faturamentos.
                </p>
                <MarkRealizedForm
                  appointmentId={appointment.id}
                  onSuccess={refetch}
                  onPendingChange={onPendingChange}
                />
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
            <CancelAppointmentForm
              appointmentId={appointment.id}
              onSuccess={refetch}
              onDirtyChange={onDirtyChange}
              onPendingChange={onPendingChange}
            />
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
            <ReversalForm
              appointmentId={appointment.id}
              onSuccess={refetch}
              onDirtyChange={onDirtyChange}
              onPendingChange={onPendingChange}
            />
          </div>
        </details>
      ) : null}

      {/* ---- Dados financeiros (colapsável) — só com finance.view_values ---- */}
      {canViewValues ? (
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
      ) : null}
    </div>
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
              accent === 'rose' ? 'h-4 w-4 text-destructive' : 'h-4 w-4 text-warning'
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
