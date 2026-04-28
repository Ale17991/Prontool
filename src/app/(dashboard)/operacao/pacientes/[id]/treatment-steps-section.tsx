'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Calendar,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  StickyNote,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { LocalProcedureTypeahead } from '@/components/tuss/local-procedure-typeahead'

export interface TreatmentStepDTO {
  id: string
  title: string
  notes: string | null
  status: 'pendente' | 'concluido' | 'cancelado'
  scheduledDate: string | null
  completedAt: string | null
  createdAt: string
  procedure: {
    id: string
    tussCode: string
    displayName: string | null
    coveredByPlan: boolean
    defaultAmountCents: number | null
  }
  doctor: {
    id: string
    fullName: string
    role: string | null
    specialty: string | null
  } | null
  healthPlan: { id: string; name: string } | null
  currentPriceCents: number | null
  priceSource: 'convenio' | 'particular' | null
  pricePlanId: string | null
}

export interface ProcedureOption {
  id: string
  tussCode: string
  displayName: string | null
  coveredByPlan: boolean
  defaultAmountCents: number | null
}

export interface HealthPlanOption {
  id: string
  name: string
}

export interface DoctorOption {
  id: string
  fullName: string
  role: string | null
  specialty: string | null
}

type StatusFilter = 'all' | 'pendente' | 'concluido' | 'cancelado'

interface Props {
  patientId: string
  patientPlanId: string | null
  patientPlanName: string | null
  initialSteps: TreatmentStepDTO[]
  procedures: ProcedureOption[]
  healthPlans: HealthPlanOption[]
  doctors: DoctorOption[]
  canWrite: boolean
}

export function TreatmentStepsSection({
  patientId,
  patientPlanId,
  patientPlanName,
  initialSteps,
  procedures,
  healthPlans,
  doctors,
  canWrite,
}: Props) {
  const router = useRouter()
  const [steps, setSteps] = useState<TreatmentStepDTO[]>(initialSteps)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [, startTransition] = useTransition()

  async function refresh() {
    const res = await fetch(`/api/pacientes/${patientId}/etapas`)
    if (res.ok) {
      const body = (await res.json()) as TreatmentStepDTO[]
      setSteps(body)
    }
    startTransition(() => router.refresh())
  }

  const counts = useMemo(() => {
    const pend = steps.filter((s) => s.status === 'pendente').length
    const done = steps.filter((s) => s.status === 'concluido').length
    const canc = steps.filter((s) => s.status === 'cancelado').length
    return { total: steps.length, pendente: pend, concluido: done, cancelado: canc }
  }, [steps])

  const pendingSteps = steps.filter((s) => s.status === 'pendente')
  const convenioCents = pendingSteps
    .filter((s) => s.priceSource === 'convenio')
    .reduce((acc, s) => acc + (s.currentPriceCents ?? 0), 0)
  const particularCents = pendingSteps
    .filter((s) => s.priceSource === 'particular')
    .reduce((acc, s) => acc + (s.currentPriceCents ?? 0), 0)
  const unpricedCount = pendingSteps.filter((s) => s.currentPriceCents === null).length

  const visibleSteps =
    filter === 'all' ? steps : steps.filter((s) => s.status === filter)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 text-primary" />
          Plano de Tratamento
        </CardTitle>
        {canWrite ? (
          <Button
            size="sm"
            variant={showForm ? 'outline' : 'default'}
            onClick={() => setShowForm((v) => !v)}
            className="gap-1.5"
          >
            {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showForm ? 'Cancelar' : 'Nova etapa'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniStat label="Total" value={counts.total.toString()} />
          <MiniStat label="Pendentes" value={counts.pendente.toString()} accent="amber" />
          <MiniStat
            label="Concluídas"
            value={`${counts.concluido}${counts.cancelado ? ` · ${counts.cancelado} canc.` : ''}`}
            accent="emerald"
          />
          <MiniStat
            label="Valor estimado (pendentes)"
            value={
              convenioCents > 0 || particularCents > 0
                ? `Convênio: ${formatCurrency(convenioCents)} · Particular: ${formatCurrency(particularCents)}`
                : counts.pendente === 0
                  ? '—'
                  : 'sem valor calculado'
            }
            sub={
              unpricedCount > 0
                ? `* valor parcial — ${unpricedCount} sem preço cadastrado`
                : undefined
            }
          />
        </div>

        {showForm && canWrite ? (
          <NewStepForm
            patientId={patientId}
            patientPlanId={patientPlanId}
            patientPlanName={patientPlanName}
            procedures={procedures}
            healthPlans={healthPlans}
            doctors={doctors}
            onCreated={async () => {
              setShowForm(false)
              await refresh()
            }}
          />
        ) : null}

        <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1 text-[11px] font-bold uppercase tracking-widest">
          <FilterTab active={filter === 'all'} onClick={() => setFilter('all')}>
            Todas · {counts.total}
          </FilterTab>
          <FilterTab active={filter === 'pendente'} onClick={() => setFilter('pendente')}>
            Pendentes · {counts.pendente}
          </FilterTab>
          <FilterTab active={filter === 'concluido'} onClick={() => setFilter('concluido')}>
            Concluídas · {counts.concluido}
          </FilterTab>
          <FilterTab active={filter === 'cancelado'} onClick={() => setFilter('cancelado')}>
            Canceladas · {counts.cancelado}
          </FilterTab>
        </div>

        <div className="space-y-2">
          {visibleSteps.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {steps.length === 0
                ? 'Nenhuma etapa cadastrada ainda.'
                : 'Nenhuma etapa no filtro atual.'}
            </p>
          ) : (
            visibleSteps.map((s, idx) => (
              <StepRow
                key={s.id}
                index={idx + 1}
                step={s}
                canWrite={canWrite}
                onChange={refresh}
                patientId={patientId}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-sm px-3 py-1.5 transition-colors',
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
      )}
    >
      {children}
    </button>
  )
}

function MiniStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'amber' | 'emerald' | 'slate'
}) {
  const accentCls =
    accent === 'amber'
      ? 'text-amber-700'
      : accent === 'emerald'
        ? 'text-emerald-700'
        : 'text-slate-900'
  return (
    <div className="rounded-md bg-white px-3 py-2 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-sm font-bold tabular-nums', accentCls)}>{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-amber-700">{sub}</p> : null}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'pendente') return <Badge variant="success">Pendente</Badge>
  if (status === 'concluido') return <Badge variant="secondary">Concluída</Badge>
  if (status === 'cancelado') return <Badge variant="destructive">Cancelada</Badge>
  return <Badge variant="outline">{status}</Badge>
}

function StepRow({
  index,
  step,
  canWrite,
  onChange,
  patientId,
}: {
  index: number
  step: TreatmentStepDTO
  canWrite: boolean
  onChange: () => void | Promise<void>
  patientId: string
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function patchStatus(nextStatus: 'concluido' | 'cancelado') {
    setError(null)
    const res = await fetch(`/api/pacientes/${patientId}/etapas/${step.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      setError(body.error?.message ?? 'Falha ao atualizar etapa.')
      return
    }
    startTransition(() => {
      void onChange()
    })
  }

  const procLabel = step.procedure.displayName
    ? `${step.procedure.displayName} (${step.procedure.tussCode})`
    : step.procedure.tussCode

  return (
    <div className="flex gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-500">
        {index}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-slate-900">{step.title}</p>
          <StatusBadge status={step.status} />
        </div>
        <ul className="space-y-0.5 text-[11px] text-slate-600">
          <li className="flex items-baseline gap-1.5">
            <span className="text-slate-400">Procedimento:</span>
            <span className="font-medium text-slate-700">{procLabel}</span>
          </li>
        </ul>
        {step.doctor ? (
          <p className="text-[11px] text-slate-600">
            <span className="font-semibold text-slate-800">
              Profissional: {step.doctor.fullName}
            </span>
            {step.doctor.role || step.doctor.specialty ? (
              <span className="text-slate-500">
                {step.doctor.role ? ` · ${step.doctor.role}` : ''}
                {step.doctor.specialty ? ` · ${step.doctor.specialty}` : ''}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-[11px] italic text-slate-400">
            Sem profissional atribuído
          </p>
        )}
        <p className="text-[11px] text-slate-500">
          <Calendar className="mr-1 inline h-3 w-3" />
          {step.scheduledDate ? `Prevista: ${formatDate(step.scheduledDate)}` : 'Sem data prevista'}
          {step.completedAt ? ` · Concluída em ${formatDate(step.completedAt)}` : ''}
        </p>
        {step.notes ? (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-600">
            <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
            <span className="whitespace-pre-wrap">{step.notes}</span>
          </p>
        ) : null}
        {error ? (
          <p className="mt-1 text-[11px] font-semibold text-rose-700">{error}</p>
        ) : null}
      </div>
      {canWrite && step.status === 'pendente' ? (
        <div className="flex shrink-0 flex-col gap-1.5">
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => patchStatus('concluido')}
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <CheckCircle2 className="h-3 w-3" />
            Concluir
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => patchStatus('cancelado')}
            className="h-7 gap-1 px-2 text-[11px] text-rose-600 hover:text-rose-700"
          >
            <X className="h-3 w-3" />
            Cancelar
          </Button>
        </div>
      ) : null}
    </div>
  )
}

type PriceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; amountCents: number }
  | { status: 'missing' }

function useFetchCurrentPrice({
  procedureId,
  healthPlanId,
  setPriceState,
}: {
  procedureId: string
  healthPlanId: string
  setPriceState: (s: PriceState) => void
}) {
  useEffect(() => {
    if (!procedureId || !healthPlanId) {
      setPriceState({ status: 'idle' })
      return
    }
    let cancelled = false
    setPriceState({ status: 'loading' })
    const qs = new URLSearchParams({ procedure_id: procedureId, plan_id: healthPlanId })
    fetch(`/api/precos/vigente?${qs.toString()}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { amountCents: number | null }) : null))
      .then((body) => {
        if (cancelled) return
        if (body && body.amountCents !== null) {
          setPriceState({ status: 'found', amountCents: body.amountCents })
        } else {
          setPriceState({ status: 'missing' })
        }
      })
      .catch(() => {
        if (!cancelled) setPriceState({ status: 'missing' })
      })
    return () => {
      cancelled = true
    }
  }, [procedureId, healthPlanId, setPriceState])
}

function PriceIndicator({
  particularOnly,
  shouldFallbackToParticular,
  procedure,
  priceState,
  planIdForMissingLink,
}: {
  particularOnly: boolean
  shouldFallbackToParticular: boolean
  procedure: ProcedureOption | null
  priceState: PriceState
  /** Quando o preço de convênio falta, linkamos direto para a tabela do plano. */
  planIdForMissingLink: string | null
}) {
  if (!procedure) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Selecione o procedimento para ver o valor estimado.
      </p>
    )
  }
  if (particularOnly || shouldFallbackToParticular) {
    if (procedure.defaultAmountCents !== null) {
      return (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          {formatCurrency(procedure.defaultAmountCents)}
          <span className="ml-2 font-normal text-amber-700/80">
            (valor particular do procedimento)
          </span>
        </p>
      )
    }
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
        Sem valor particular cadastrado neste procedimento.{' '}
        <Link href="/cadastros/procedimentos" className="underline">
          Cadastrar valor particular
        </Link>
      </p>
    )
  }
  if (priceState.status === 'loading') {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Consultando preço vigente…
      </p>
    )
  }
  if (priceState.status === 'found') {
    return (
      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
        {formatCurrency(priceState.amountCents)}
        <span className="ml-2 font-normal text-emerald-700/80">
          (preço vigente para essa combinação)
        </span>
      </p>
    )
  }
  if (priceState.status === 'missing') {
    const href = planIdForMissingLink
      ? `/cadastros/planos/${planIdForMissingLink}`
      : '/cadastros/planos'
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
        Sem preço cadastrado para este procedimento neste plano.{' '}
        <Link href={href} className="underline">
          Cadastrar preço
        </Link>
      </p>
    )
  }
  return (
    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
      Selecione o plano para ver o valor do convênio.
    </p>
  )
}

function NewStepForm({
  patientId,
  patientPlanId,
  patientPlanName,
  procedures,
  healthPlans,
  doctors,
  onCreated,
}: {
  patientId: string
  patientPlanId: string | null
  patientPlanName: string | null
  procedures: ProcedureOption[]
  healthPlans: HealthPlanOption[]
  doctors: DoctorOption[]
  onCreated: () => void | Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [procedureId, setProcedureId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [healthPlanId, setHealthPlanId] = useState<string>(patientPlanId ?? '__none__')
  const [scheduledDate, setScheduledDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictWarning, setConflictWarning] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Pre-check de conflito de horario quando doctor + scheduled_date + start + end mudam.
  useEffect(() => {
    if (!doctorId || !scheduledDate || !startTime || !endTime) {
      setConflictWarning(null)
      return
    }
    const startIso = combineDateTimeToIso(scheduledDate, startTime)
    const endIso = combineDateTimeToIso(scheduledDate, endTime, startTime)
    if (!startIso || !endIso || new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setConflictWarning(null)
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          doctor_id: doctorId,
          start: startIso,
          end: endIso,
        })
        const res = await fetch(`/api/atendimentos/check-conflict?${params.toString()}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) {
          setConflictWarning(null)
          return
        }
        const body = (await res.json()) as
          | { conflict: false }
          | {
              conflict: true
              with: { patient_name: string; start_at: string; end_at: string }
            }
        if (body.conflict) {
          const startLocal = new Date(body.with.start_at).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })
          const endLocal = new Date(body.with.end_at).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })
          setConflictWarning(
            `Conflito com ${body.with.patient_name} das ${startLocal} às ${endLocal}.`,
          )
        } else {
          setConflictWarning(null)
        }
      } catch {
        // abort or network — silencioso
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [doctorId, scheduledDate, startTime, endTime])

  const selectedProcedure = procedures.find((p) => p.id === procedureId) ?? null
  const particularOnly = selectedProcedure && !selectedProcedure.coveredByPlan
  const isSentinelNoPlan = healthPlanId === '__none__'
  const effectivePlanForConvenio =
    particularOnly || isSentinelNoPlan ? '' : healthPlanId
  const shouldFallbackToParticular =
    !!selectedProcedure &&
    selectedProcedure.coveredByPlan &&
    (!healthPlanId || isSentinelNoPlan)

  const [priceState, setPriceState] = useState<PriceState>({ status: 'idle' })
  useFetchCurrentPrice({
    procedureId,
    healthPlanId: effectivePlanForConvenio,
    setPriceState,
  })

  const filtered = search.trim().length === 0
    ? procedures.slice(0, 50)
    : procedures
        .filter((p) => {
          const q = search.toLowerCase()
          return (
            p.tussCode.toLowerCase().includes(q) ||
            (p.displayName ?? '').toLowerCase().includes(q)
          )
        })
        .slice(0, 50)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (title.trim().length < 1) {
      setError('Informe um título para a etapa.')
      return
    }
    if (!procedureId) {
      setError('Selecione um procedimento.')
      return
    }
    if (!doctorId) {
      setError('Selecione o profissional responsável.')
      return
    }
    if (!scheduledDate) {
      setError('Informe a data prevista.')
      return
    }
    if (!startTime || !endTime) {
      setError('Informe horário de início e fim.')
      return
    }
    if (toMinutes(endTime) <= toMinutes(startTime)) {
      setError('Hora de fim deve ser depois do início.')
      return
    }
    if (conflictWarning) {
      setError(conflictWarning + ' Ajuste o horário antes de salvar.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/etapas`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          procedure_id: procedureId,
          doctor_id: doctorId,
          health_plan_id:
            particularOnly || isSentinelNoPlan || !healthPlanId ? null : healthPlanId,
          title: title.trim(),
          notes: notes.trim() || null,
          scheduled_date: scheduledDate,
          start_time: startTime,
          end_time: endTime,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string }
        }
        if (res.status === 409 || body.error?.code === 'APPOINTMENT_CONFLICT') {
          setError(
            body.error?.message ??
              'Conflito de horário com outro atendimento deste profissional.',
          )
        } else {
          setError(body.error?.message ?? 'Falha ao adicionar etapa.')
        }
        return
      }
      await onCreated()
    } finally {
      setPending(false)
    }
  }

  function toMinutes(hhmm: string): number {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
    if (!m) return 0
    return parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10)
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4 md:grid-cols-2"
    >
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="step_title">
          Título da etapa <span className="text-rose-500">*</span>
        </Label>
        <Input
          id="step_title"
          autoFocus
          placeholder="Ex.: Sessão 1 — Avaliação inicial"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="step_proc_search">
          Procedimento <span className="text-rose-500">*</span>
        </Label>
        <LocalProcedureTypeahead
          id="step_proc_search"
          options={procedures.map((p) => ({
            id: p.id,
            tussCode: p.tussCode,
            displayName: p.displayName,
          }))}
          value={procedureId}
          onChange={setProcedureId}
        />
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="step_doctor">
          Profissional responsável <span className="text-rose-500">*</span>
        </Label>
        {doctors.length === 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            Nenhum profissional ativo cadastrado.{' '}
            <Link href="/cadastros/profissionais" className="underline">
              Cadastrar profissional
            </Link>
          </p>
        ) : (
          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger id="step_doctor">
              <SelectValue placeholder="Selecione um profissional…" />
            </SelectTrigger>
            <SelectContent>
              {doctors.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.fullName}
                  {d.role || d.specialty ? (
                    <span className="text-slate-500">
                      {d.role ? ` — ${d.role}` : ''}
                      {d.specialty ? ` — ${d.specialty}` : ''}
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {particularOnly ? (
        <div className="space-y-1.5">
          <Label>Plano de saúde</Label>
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            Procedimento particular — sempre cobrado no valor particular.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="step_plan">
            Plano de saúde
            {patientPlanName ? (
              <span className="ml-1 text-[10px] font-normal text-slate-400">
                (padrão do paciente: {patientPlanName})
              </span>
            ) : null}
          </Label>
          <Select value={healthPlanId} onValueChange={setHealthPlanId}>
            <SelectTrigger id="step_plan">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sem plano (particular)</SelectItem>
              {healthPlans.map((hp) => (
                <SelectItem key={hp.id} value={hp.id}>
                  {hp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="step_date">
          Data prevista <span className="text-rose-500">*</span>
        </Label>
        <Input
          id="step_date"
          type="date"
          required
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="step_start">
            Hora início <span className="text-rose-500">*</span>
          </Label>
          <Input
            id="step_start"
            type="time"
            required
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value)
              // Sugere fim = inicio + 30 min se ainda nao houver
              if (!endTime && e.target.value) {
                const m = /^(\d{2}):(\d{2})$/.exec(e.target.value)
                if (m) {
                  const total = parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10) + 30
                  const norm = ((total % 1440) + 1440) % 1440
                  const hh = `${Math.floor(norm / 60)}`.padStart(2, '0')
                  const mm = `${norm % 60}`.padStart(2, '0')
                  setEndTime(`${hh}:${mm}`)
                }
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="step_end">
            Hora fim <span className="text-rose-500">*</span>
          </Label>
          <Input
            id="step_end"
            type="time"
            required
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>

      {conflictWarning ? (
        <div
          role="alert"
          className="md:col-span-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
        >
          {conflictWarning}
        </div>
      ) : null}

      <div className="space-y-1.5 md:col-span-2">
        <Label>Valor estimado</Label>
        <PriceIndicator
          particularOnly={!!particularOnly}
          shouldFallbackToParticular={shouldFallbackToParticular}
          procedure={selectedProcedure}
          priceState={priceState}
          planIdForMissingLink={effectivePlanForConvenio || null}
        />
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="step_notes">Observações (opcional)</Label>
        <Textarea
          id="step_notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-[64px]"
        />
      </div>

      {error ? (
        <div className="md:col-span-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="md:col-span-2 flex justify-end">
        <Button type="submit" size="sm" disabled={pending || !!conflictWarning} className="gap-2">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Adicionar etapa
        </Button>
      </div>
    </form>
  )
}

/**
 * Combina data (YYYY-MM-DD) + hora (HH:MM), interpretado em fuso local,
 * em ISO UTC. Se `referenceStart` for fornecido e `time` for menor, assume
 * que cruzou meia-noite e adiciona 1 dia.
 */
function combineDateTimeToIso(
  date: string,
  time: string,
  referenceStart?: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  if (!/^\d{2}:\d{2}$/.test(time)) return null
  const dt = new Date(`${date}T${time}:00`)
  if (Number.isNaN(dt.getTime())) return null
  if (referenceStart && /^\d{2}:\d{2}$/.test(referenceStart)) {
    const startMin = parseInt(referenceStart.slice(0, 2), 10) * 60 + parseInt(referenceStart.slice(3), 10)
    const endMin = parseInt(time.slice(0, 2), 10) * 60 + parseInt(time.slice(3), 10)
    if (endMin <= startMin) dt.setDate(dt.getDate() + 1)
  }
  return dt.toISOString()
}
