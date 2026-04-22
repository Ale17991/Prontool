'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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

export interface PlanSummary {
  id: string
  title: string
  description: string | null
  status: 'ativo' | 'concluido' | 'cancelado'
  createdAt: string
  stepsTotal: number
  stepsPending: number
  stepsCompleted: number
  stepsCancelled: number
}

export interface PlanDetailStep {
  id: string
  title: string
  notes: string | null
  status: 'pendente' | 'concluido' | 'cancelado'
  scheduledDate: string | null
  completedAt: string | null
  createdAt: string
  procedure: { id: string; tussCode: string; displayName: string | null }
  healthPlan: { id: string; name: string } | null
  currentPriceCents: number | null
  pricePlanId: string | null
}

export interface PlanDetail {
  id: string
  patientId: string
  title: string
  description: string | null
  status: 'ativo' | 'concluido' | 'cancelado'
  createdAt: string
  steps: PlanDetailStep[]
}

export interface ProcedureOption {
  id: string
  tussCode: string
  displayName: string | null
}

export interface HealthPlanOption {
  id: string
  name: string
}

interface TreatmentPlansSectionProps {
  patientId: string
  /** Plano de saúde padrão do paciente. Pré-preenche e calcula o valor estimado quando a etapa não tem plano próprio. */
  patientPlanId: string | null
  patientPlanName: string | null
  initialPlans: PlanSummary[]
  procedures: ProcedureOption[]
  healthPlans: HealthPlanOption[]
  canWrite: boolean
}

export function TreatmentPlansSection({
  patientId,
  patientPlanId,
  patientPlanName,
  initialPlans,
  procedures,
  healthPlans,
  canWrite,
}: TreatmentPlansSectionProps) {
  const router = useRouter()
  const [plans, setPlans] = useState<PlanSummary[]>(initialPlans)
  const [details, setDetails] = useState<Record<string, PlanDetail | undefined>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [showNewPlan, setShowNewPlan] = useState(false)

  async function fetchDetail(planId: string) {
    setLoadingId(planId)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/planos/${planId}`)
      if (!res.ok) return
      const body = (await res.json()) as PlanDetail
      setDetails((prev) => ({ ...prev, [planId]: body }))
    } finally {
      setLoadingId(null)
    }
  }

  async function toggleExpand(planId: string) {
    if (expanded === planId) {
      setExpanded(null)
      return
    }
    setExpanded(planId)
    if (!details[planId]) {
      await fetchDetail(planId)
    }
  }

  async function refresh(planId?: string) {
    const res = await fetch(`/api/pacientes/${patientId}/planos`)
    if (res.ok) {
      const body = (await res.json()) as PlanSummary[]
      setPlans(body)
    }
    if (planId) await fetchDetail(planId)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 text-primary" />
          Plano de Tratamento
        </CardTitle>
        {canWrite ? (
          <Button
            variant={showNewPlan ? 'outline' : 'default'}
            size="sm"
            onClick={() => setShowNewPlan((v) => !v)}
            className="gap-2"
          >
            {showNewPlan ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showNewPlan ? 'Cancelar' : 'Novo plano'}
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {showNewPlan && canWrite ? (
          <NewPlanForm
            patientId={patientId}
            onCreated={async () => {
              setShowNewPlan(false)
              await refresh()
            }}
          />
        ) : null}

        {plans.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nenhum plano de tratamento cadastrado ainda.
          </p>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                expanded={expanded === p.id}
                loading={loadingId === p.id}
                detail={details[p.id]}
                procedures={procedures}
                healthPlans={healthPlans}
                canWrite={canWrite}
                onToggle={() => toggleExpand(p.id)}
                onStepChange={() => refresh(p.id)}
                patientId={patientId}
                patientPlanId={patientPlanId}
                patientPlanName={patientPlanName}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function NewPlanForm({
  patientId,
  onCreated,
}: {
  patientId: string
  onCreated: () => void | Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (title.trim().length < 1) {
      setError('Informe um título.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/planos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao criar plano.')
        return
      }
      setTitle('')
      setDescription('')
      await onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4 md:grid-cols-2"
    >
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="plan_title">Título do plano</Label>
        <Input
          id="plan_title"
          autoFocus
          placeholder="Ex.: Tratamento Ortopédico — joelho D"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="plan_description">Observações (opcional)</Label>
        <Textarea
          id="plan_description"
          placeholder="Anotações gerais sobre o plano…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[72px]"
        />
      </div>
      {error ? (
        <div className="md:col-span-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}
      <div className="md:col-span-2 flex justify-end">
        <Button type="submit" disabled={pending} size="sm" className="gap-2">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Criar plano
        </Button>
      </div>
    </form>
  )
}

function PlanCard({
  plan,
  expanded,
  loading,
  detail,
  procedures,
  healthPlans,
  canWrite,
  onToggle,
  onStepChange,
  patientId,
  patientPlanId,
  patientPlanName,
}: {
  plan: PlanSummary
  expanded: boolean
  loading: boolean
  detail: PlanDetail | undefined
  procedures: ProcedureOption[]
  healthPlans: HealthPlanOption[]
  canWrite: boolean
  onToggle: () => void
  onStepChange: () => void | Promise<void>
  patientId: string
  patientPlanId: string | null
  patientPlanName: string | null
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex min-w-0 items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{plan.title}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Criado em {formatDate(plan.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          <StatusBadge status={plan.status} />
          <Badge variant="secondary" className="font-mono">
            {plan.stepsPending}/{plan.stepsTotal} pendentes
          </Badge>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 bg-slate-50/40 p-4">
          {loading && !detail ? (
            <div className="flex items-center justify-center py-8 text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : detail ? (
            <PlanDetailBlock
              detail={detail}
              procedures={procedures}
              healthPlans={healthPlans}
              canWrite={canWrite && plan.status === 'ativo'}
              onStepChange={onStepChange}
              patientId={patientId}
              patientPlanId={patientPlanId}
              patientPlanName={patientPlanName}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ativo' || status === 'pendente') {
    return <Badge variant="success">{status === 'ativo' ? 'Ativo' : 'Pendente'}</Badge>
  }
  if (status === 'concluido') return <Badge variant="secondary">Concluído</Badge>
  if (status === 'cancelado') return <Badge variant="destructive">Cancelado</Badge>
  return <Badge variant="outline">{status}</Badge>
}

function PlanDetailBlock({
  detail,
  procedures,
  healthPlans,
  canWrite,
  onStepChange,
  patientId,
  patientPlanId,
  patientPlanName,
}: {
  detail: PlanDetail
  procedures: ProcedureOption[]
  healthPlans: HealthPlanOption[]
  canWrite: boolean
  onStepChange: () => void | Promise<void>
  patientId: string
  patientPlanId: string | null
  patientPlanName: string | null
}) {
  const [showAddStep, setShowAddStep] = useState(false)

  const pendingSteps = detail.steps.filter((s) => s.status === 'pendente')
  const pending = pendingSteps.length
  const completed = detail.steps.filter((s) => s.status === 'concluido').length
  const cancelled = detail.steps.filter((s) => s.status === 'cancelado').length

  const totalCents = pendingSteps.reduce(
    (acc, s) => acc + (s.currentPriceCents ?? 0),
    0,
  )
  const unpricedCount = pendingSteps.filter((s) => s.currentPriceCents === null).length

  return (
    <div className="space-y-4">
      {detail.description ? (
        <p className="rounded-md bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
          {detail.description}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat label="Etapas" value={`${detail.steps.length}`} />
        <MiniStat label="Pendentes" value={`${pending}`} accent="amber" />
        <MiniStat
          label="Concluídas"
          value={`${completed}${cancelled ? ` · ${cancelled} canceladas` : ''}`}
          accent="emerald"
        />
        <MiniStat
          label="Valor estimado"
          value={formatCurrency(totalCents)}
          sub={
            unpricedCount > 0
              ? `* valor parcial — ${unpricedCount} sem preço`
              : pending === 0
                ? 'nenhuma etapa pendente'
                : undefined
          }
          accent="slate"
        />
      </div>

      <div className="space-y-3">
        {detail.steps.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nenhuma etapa cadastrada. Adicione a primeira.
          </p>
        ) : (
          detail.steps.map((s, idx) => (
            <StepRow
              key={s.id}
              index={idx + 1}
              step={s}
              canWrite={canWrite}
              onChange={onStepChange}
              patientId={patientId}
              planId={detail.id}
            />
          ))
        )}
      </div>

      {canWrite ? (
        <div>
          {showAddStep ? (
            <AddStepForm
              procedures={procedures}
              healthPlans={healthPlans}
              onCancel={() => setShowAddStep(false)}
              onAdded={async () => {
                setShowAddStep(false)
                await onStepChange()
              }}
              patientId={patientId}
              planId={detail.id}
              patientPlanId={patientPlanId}
              patientPlanName={patientPlanName}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddStep(true)}
              className="gap-2"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar etapa
            </Button>
          )}
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

function StepRow({
  index,
  step,
  canWrite,
  onChange,
  patientId,
  planId,
}: {
  index: number
  step: PlanDetailStep
  canWrite: boolean
  onChange: () => void | Promise<void>
  patientId: string
  planId: string
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function patchStatus(nextStatus: 'concluido' | 'cancelado') {
    setError(null)
    const res = await fetch(
      `/api/pacientes/${patientId}/planos/${planId}/steps/${step.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      },
    )
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
    <div className="relative flex gap-3 rounded-md bg-white px-4 py-3 shadow-sm">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-500">
        {index}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-slate-900">{step.title}</p>
          <StatusBadge status={step.status} />
        </div>
        <p className="text-[11px] text-slate-600">
          <span className="font-mono">{procLabel}</span>
          {step.healthPlan ? ` · Plano: ${step.healthPlan.name}` : ''}
        </p>
        <p className="text-[11px] text-slate-500">
          {step.scheduledDate ? `Previsto: ${formatDate(step.scheduledDate)}` : 'Sem data prevista'}
          {step.completedAt ? ` · Concluído em ${formatDate(step.completedAt)}` : ''}
        </p>
        {step.status === 'pendente' ? (
          <p
            className={
              step.currentPriceCents !== null
                ? 'text-[11px] font-semibold text-slate-700'
                : 'text-[11px] font-semibold text-amber-700'
            }
          >
            {step.currentPriceCents !== null
              ? `Valor estimado: ${formatCurrency(step.currentPriceCents)}`
              : 'Sem preço cadastrado para este procedimento neste plano'}
          </p>
        ) : null}
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

function AddStepForm({
  procedures,
  healthPlans,
  onCancel,
  onAdded,
  patientId,
  planId,
  patientPlanId,
  patientPlanName,
}: {
  procedures: ProcedureOption[]
  healthPlans: HealthPlanOption[]
  onCancel: () => void
  onAdded: () => void | Promise<void>
  patientId: string
  planId: string
  patientPlanId: string | null
  patientPlanName: string | null
}) {
  const [title, setTitle] = useState('')
  const [procedureId, setProcedureId] = useState('')
  // Pré-seleciona plano do paciente — o profissional pode trocar se a etapa
  // específica usa outro plano.
  const [healthPlanId, setHealthPlanId] = useState<string>(patientPlanId ?? '')
  const [scheduledDate, setScheduledDate] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Preço vigente para (procedure, plan, hoje). null = não consultado ainda
  // ou sem resultado; a gente deriva qual dos dois.
  const [priceState, setPriceState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'found'; amountCents: number }
    | { status: 'missing' }
  >({ status: 'idle' })

  // Busca preço sempre que procedure e plano estiverem definidos.
  // useEffect via React quando muda o par. Simples: efeito encadeado.
  // Usar import de useEffect foi omitido; puxamos aqui.
  useFetchCurrentPrice({ procedureId, healthPlanId, setPriceState })

  // Typeahead simples para procedimento: filtra lista carregada.
  const [search, setSearch] = useState('')
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
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/planos/${planId}/steps`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          procedure_id: procedureId,
          health_plan_id: healthPlanId || null,
          title: title.trim(),
          notes: notes.trim() || null,
          scheduled_date: scheduledDate || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao adicionar etapa.')
        return
      }
      await onAdded()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2"
    >
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="step_title">Título da etapa</Label>
        <Input
          id="step_title"
          autoFocus
          placeholder="Ex.: Sessão 1 — Avaliação inicial"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="step_proc_search">Procedimento</Label>
        <Input
          id="step_proc_search"
          placeholder="Buscar por TUSS ou nome…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/50 text-xs">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-slate-400">Nenhum procedimento encontrado.</p>
          ) : (
            filtered.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setProcedureId(p.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white',
                  p.id === procedureId ? 'bg-white font-bold text-primary' : 'text-slate-600',
                )}
              >
                <span className="truncate">
                  {p.displayName ?? '(sem nome)'}
                </span>
                <span className="ml-2 font-mono text-[10px] text-slate-500">{p.tussCode}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="step_plan">
          Plano de saúde
          {patientPlanName ? (
            <span className="ml-1 text-[10px] font-normal text-slate-400">
              (padrão: {patientPlanName})
            </span>
          ) : null}
        </Label>
        <Select value={healthPlanId} onValueChange={setHealthPlanId}>
          <SelectTrigger id="step_plan">
            <SelectValue placeholder="Sem plano" />
          </SelectTrigger>
          <SelectContent>
            {healthPlans.map((hp) => (
              <SelectItem key={hp.id} value={hp.id}>
                {hp.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <Label>Valor estimado</Label>
        {priceState.status === 'found' ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
            {formatCurrency(priceState.amountCents)}
            <span className="ml-2 font-normal text-emerald-700/80">
              (preço vigente para essa combinação)
            </span>
          </p>
        ) : priceState.status === 'loading' ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Consultando preço vigente…
          </p>
        ) : priceState.status === 'missing' ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            Sem preço cadastrado para este procedimento neste plano.{' '}
            <Link href="/cadastros/precos/novo" className="underline">
              Cadastrar preço
            </Link>
          </p>
        ) : (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Selecione procedimento e plano para ver o valor estimado.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="step_date">Data prevista (opcional)</Label>
        <Input
          id="step_date"
          type="date"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
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

      <div className="md:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Adicionar etapa
        </Button>
      </div>
    </form>
  )
}
