'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCheck, CheckCircle2, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { type LocalProcedureOption } from '@/components/tuss/local-procedure-typeahead'
import {
  PatientTypeahead,
  type PatientTypeaheadValue,
} from '@/components/patients/patient-typeahead'
import {
  MateriaisEditor,
  validateMaterials,
  type MaterialDraft,
} from '@/components/atendimentos/materiais-editor'
import {
  ProcedurasEditor,
  validateProcedures,
  type ProcedureLineDraft,
} from '@/components/atendimentos/procedimentos-editor'
import {
  AssistantMultiSelect,
  type AssistantSelection,
  type LiberalDoctorOption,
} from '../components/assistant-multi-select'

export interface FormOption {
  id: string
  label: string
}

export interface NewAppointmentFormProps {
  doctors: FormOption[]
  /** Profissionais com modalidade Liberal — elegíveis como assistentes. */
  liberalDoctors: LiberalDoctorOption[]
  procedures: LocalProcedureOption[]
  plans: FormOption[]
  initialAppointmentAt?: string
}

type PaymentMethod =
  | 'dinheiro'
  | 'pix'
  | 'cartao_credito'
  | 'cartao_debito'
  | 'boleto'
  | 'convenio'
  | 'outro'

const METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'pix', label: 'PIX' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'convenio', label: 'Convênio' },
  { value: 'outro', label: 'Outro' },
]

export function NewAppointmentForm({
  doctors,
  liberalDoctors,
  procedures,
  plans,
  initialAppointmentAt,
}: NewAppointmentFormProps) {
  const router = useRouter()
  const [patient, setPatient] = useState<PatientTypeaheadValue | null>(null)
  const patientId = patient?.id ?? ''
  const [doctorId, setDoctorId] = useState('')
  const defaultPlanId = patient?.planId ?? null
  // Lista inicia vazia — usuário adiciona procedimentos via busca no editor.
  const [procedureLines, setProcedureLines] = useState<ProcedureLineDraft[]>([])
  const [materiais, setMateriais] = useState<MaterialDraft[]>([])
  const [assistants, setAssistants] = useState<AssistantSelection[]>([])
  const [appointmentAt, setAppointmentAt] = useState(
    () => normalizeInitialAt(initialAppointmentAt) ?? localIsoNow(),
  )
  const [endTime, setEndTime] = useState<string>(() => {
    const start = normalizeInitialAt(initialAppointmentAt) ?? localIsoNow()
    return addMinutesToHHMM(start.slice(11), 30)
  })
  const [observacoes, setObservacoes] = useState('')
  const [addToTreatmentPlan, setAddToTreatmentPlan] = useState(true)
  const [allDay, setAllDay] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [conflictWarning, setConflictWarning] = useState<string | null>(null)
  // Acao a executar apos salvar: somente salvar (agendado), confirmar
  // (chama /confirmar) ou marcar presenca (chama /realizado).
  type PostSaveAction = 'save' | 'confirm' | 'realize'
  const submitActionRef = useRef<PostSaveAction>('save')
  const [activeAction, setActiveAction] = useState<PostSaveAction | null>(null)
  const [confirmAction, setConfirmAction] = useState<'confirm' | 'realize' | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const durationMinutes = computeDurationMinutes(appointmentAt, endTime)

  // Pagamento
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [installmentsCount, setInstallmentsCount] = useState<number>(1)
  const [installmentDates, setInstallmentDates] = useState<string[]>([])
  const [paymentStatus, setPaymentStatus] = useState<'pago' | 'pendente'>('pago')
  const [paymentPaidAt, setPaymentPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  )

  // 016 punch list #4 — split de pagamento em N metodos.
  // Quando ativo, cria N payment_records sobre o mesmo appointment_id,
  // cada um com metodo e valor proprio. Resolve a queixa #1 do iClinic
  // na Reclame Aqui (impossivel pagar 50% PIX + 50% cartao). Estendido
  // para N (≤5) na correcao de pagamentos: clinicas pedem suporte a
  // parcelar entre 3+ metodos (ex.: PIX + cartao + dinheiro).
  const [splitPayment, setSplitPayment] = useState(false)
  const [splitParts, setSplitParts] = useState<
    Array<{ method: PaymentMethod; percent: number }>
  >([
    { method: 'pix', percent: 50 },
    { method: 'cartao_credito', percent: 50 },
  ])
  const MAX_SPLIT_PARTS = 5

  // Recalcula datas das parcelas quando o numero muda.
  useEffect(() => {
    if (installmentsCount <= 0) return
    const today = new Date()
    const next: string[] = []
    for (let i = 0; i < installmentsCount; i++) {
      const d = new Date(today)
      d.setMonth(d.getMonth() + i)
      const y = d.getFullYear()
      const m = `${d.getMonth() + 1}`.padStart(2, '0')
      const day = `${d.getDate()}`.padStart(2, '0')
      next.push(`${y}-${m}-${day}`)
    }
    setInstallmentDates(next)
  }, [installmentsCount])

  // Pre-check de conflito de horario com debounce.
  useEffect(() => {
    if (!doctorId || !appointmentAt || !endTime) {
      setConflictWarning(null)
      return
    }
    const startIso = new Date(appointmentAt).toISOString()
    const endIso = computeEndIso(appointmentAt, endTime)
    if (!endIso || new Date(endIso).getTime() <= new Date(startIso).getTime()) {
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
        // abort ou rede — silencioso
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [doctorId, appointmentAt, endTime])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!patientId || !doctorId) {
      setError('Selecione paciente e profissional.')
      return
    }

    if (procedureLines.length === 0) {
      setError('Adicione pelo menos um procedimento usando a busca acima.')
      return
    }
    const validatedProcedures = validateProcedures(procedureLines)
    if (!validatedProcedures) {
      setError('Preencha plano e valor (>= 0) em todas as linhas.')
      return
    }

    // Atendimentos com valor zero sao permitidos (consultas/procedimentos
    // gratuitos). Quando totalCents === 0 nao geramos payment_record e
    // tambem nao exigimos forma de pagamento.

    // Split em N metodos: valida que a soma dos percentuais = 100 e
    // todos os metodos foram preenchidos.
    if (splitPayment) {
      if (splitParts.length < 2) {
        setError('Split de pagamento exige pelo menos 2 métodos.')
        return
      }
      const sumPercent = splitParts.reduce((s, p) => s + p.percent, 0)
      if (sumPercent !== 100) {
        setError(`A soma dos percentuais deve ser 100% (atual: ${sumPercent}%).`)
        return
      }
      if (splitParts.some((p) => p.percent <= 0)) {
        setError('Cada método do split deve ter percentual > 0.')
        return
      }
    }

    // Para 'dia inteiro' forcamos appointment_at = data 00:00 local
    // (interpretado como o dia escolhido) e duration_minutes=1440 (24h).
    // Constraint apointments_duration_minutes_check aceita ate 1440
    // apos migration 0083.
    let whenIso: string
    let durationToSend: number
    if (allDay) {
      const datePart = appointmentAt.slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        setError('Data inválida.')
        return
      }
      whenIso = new Date(`${datePart}T00:00:00`).toISOString()
      durationToSend = 1440
    } else {
      whenIso = new Date(appointmentAt).toISOString()
      const endIso = computeEndIso(appointmentAt, endTime)
      if (!endIso || new Date(endIso).getTime() <= new Date(whenIso).getTime()) {
        setError('Hora de fim deve ser depois do início.')
        return
      }
      if (conflictWarning) {
        setError(conflictWarning + ' Ajuste o horário antes de salvar.')
        return
      }
      durationToSend = clampDuration(durationMinutes)
    }

    const payload: Record<string, unknown> = {
      patient_id: patientId,
      doctor_id: doctorId,
      procedures: validatedProcedures.map((p) => ({
        procedure_id: p.procedureId,
        plan_id: p.planId,
        amount_cents_override: p.amountCentsOverride,
        notes: p.notes,
        quantity: p.quantity,
      })),
      appointment_at: whenIso,
      duration_minutes: durationToSend,
      add_to_treatment_plan: addToTreatmentPlan,
    }
    if (observacoes.trim()) payload.observacoes = observacoes.trim().slice(0, 500)

    if (materiais.length > 0) {
      const validated = validateMaterials(materiais)
      if (!validated) {
        setError('Algum material está com quantidade inválida. Corrija antes de salvar.')
        return
      }
      payload.materiais = validated.map((m) => ({
        tuss_code: m.tussCode,
        tuss_description: m.tussDescription,
        quantity: m.quantity,
      }))
    }

    if (assistants.length > 0) {
      // Validacao: todos com amount > 0.
      if (assistants.some((a) => a.amountCents <= 0)) {
        setError('Todos os assistentes precisam ter valor de participação maior que zero.')
        return
      }
      payload.assistants = assistants.map((a) => ({
        assistant_doctor_id: a.doctorId,
        amount_cents: a.amountCents,
      }))
    }

    setPending(true)
    setWarning(null)
    // Flag para distinguir "submit deu certo, vai navegar" de "submit
    // falhou". No primeiro caso `pending` segue true (componente desmonta);
    // no segundo, o `finally` re-habilita o botão.
    let success = false
    try {
      const res = await fetch('/api/atendimentos/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => ({}))) as {
        appointment_id?: string
        error?: { code?: string; message?: string }
      }
      if (!res.ok || !body.appointment_id) {
        if (res.status === 409 || body.error?.code === 'APPOINTMENT_CONFLICT') {
          setError(
            body.error?.message ??
              'Conflito de horário com outro atendimento deste profissional.',
          )
        } else {
          setError(body.error?.message ?? 'Falha ao registrar atendimento.')
        }
        return
      }

      // Total = soma de (unitario * quantidade) de cada linha.
      const totalCents = validatedProcedures.reduce(
        (acc, p) => acc + p.amountCentsOverride * p.quantity,
        0,
      )
      if (totalCents > 0) {
        const paidAtIso =
          paymentStatus === 'pago' ? new Date(paymentPaidAt).toISOString() : null

        // Split em N metodos: cria N payment_records distintos (cada
        // um com seu metodo), todos vinculados ao mesmo appointment_id.
        // Distribui o totalCents proporcional aos percentuais. O ultimo
        // pega o residuo de divisao para fechar exatamente o total.
        if (splitPayment) {
          const today = new Date().toISOString().slice(0, 10)
          const parts: Array<{ method: PaymentMethod; amount: number }> = []
          let allocated = 0
          for (let i = 0; i < splitParts.length; i++) {
            const sp = splitParts[i]!
            const isLast = i === splitParts.length - 1
            const amount = isLast
              ? totalCents - allocated
              : Math.floor((totalCents * sp.percent) / 100)
            allocated += amount
            parts.push({ method: sp.method, amount })
          }
          for (const part of parts) {
            if (part.amount <= 0) continue
            const res = await fetch('/api/pagamentos', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                patient_id: patientId,
                appointment_id: body.appointment_id,
                total_amount_cents: part.amount,
                payment_method: part.method,
                installments: [
                  {
                    installment_number: 1,
                    amount_cents: part.amount,
                    due_date: today,
                  },
                ],
                initial_status: paymentStatus,
                paid_at: paidAtIso,
              }),
            })
            if (!res.ok) {
              const payBody = (await res.json().catch(() => ({}))) as {
                error?: { message?: string }
              }
              setWarning(
                `Atendimento salvo, mas uma das partes do pagamento falhou (${part.method}): ${payBody.error?.message ?? 'erro desconhecido'}. Registre manualmente em /operacao/pacientes/${patientId}.`,
              )
              break
            }
          }
        } else {
          const installments = installmentDates.map((due, idx) => {
            const base = Math.floor(totalCents / installmentsCount)
            const remainder = totalCents - base * installmentsCount
            return {
              installment_number: idx + 1,
              amount_cents: idx === 0 ? base + remainder : base,
              due_date: due,
            }
          })
          const payRes = await fetch('/api/pagamentos', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              patient_id: patientId,
              appointment_id: body.appointment_id,
              total_amount_cents: totalCents,
              payment_method: paymentMethod,
              installments,
              initial_status: paymentStatus,
              paid_at: paidAtIso,
            }),
          })
          if (!payRes.ok) {
            const payBody = (await payRes.json().catch(() => ({}))) as {
              error?: { message?: string }
            }
            setWarning(
              `Atendimento salvo, mas o pagamento falhou: ${payBody.error?.message ?? 'erro desconhecido'}. Registre manualmente em /operacao/pacientes/${patientId}.`,
            )
          }
        }
      }

      // Acao pos-criacao: confirmar ou marcar presenca. Sequencial — se
      // falhar, atendimento ja esta salvo e mostramos warning.
      const action = submitActionRef.current
      if (action === 'confirm') {
        const confirmRes = await fetch(
          `/api/atendimentos/${body.appointment_id}/confirmar`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        )
        if (!confirmRes.ok) {
          const cb = (await confirmRes.json().catch(() => ({}))) as {
            error?: { message?: string }
          }
          setWarning(
            `Atendimento salvo, mas a confirmacao falhou: ${cb.error?.message ?? 'erro desconhecido'}. Voce pode confirmar manualmente na tela do atendimento.`,
          )
        }
      } else if (action === 'realize') {
        const realizeRes = await fetch(
          `/api/atendimentos/${body.appointment_id}/realizado`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        )
        if (!realizeRes.ok) {
          const rb = (await realizeRes.json().catch(() => ({}))) as {
            error?: { message?: string }
          }
          setWarning(
            `Atendimento salvo, mas o registro de presenca falhou: ${rb.error?.message ?? 'erro desconhecido'}. Voce pode confirmar presenca manualmente na tela do atendimento.`,
          )
        }
      }

      success = true
      router.push(`/operacao/atendimentos/${body.appointment_id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // Só re-habilita quando deu erro/cancel. No sucesso, mantém
      // pending=true até a página desmontar pela navegação — evita
      // double-submit (atendimento criado em duplicata).
      if (!success) {
        setPending(false)
        setActiveAction(null)
      }
    }
  }

  function triggerSubmit(action: PostSaveAction) {
    submitActionRef.current = action
    setActiveAction(action)
  }

  function handleProtectedAction(action: 'confirm' | 'realize') {
    setConfirmAction(action)
  }

  function proceedAfterDialogConfirm() {
    if (!confirmAction) return
    submitActionRef.current = confirmAction
    setActiveAction(confirmAction)
    setConfirmAction(null)
    formRef.current?.requestSubmit()
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
    >
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="patient_id">Paciente</Label>
        <PatientTypeahead
          id="patient_id"
          value={patient?.id ?? null}
          onChange={setPatient}
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="doctor_id">Profissional</Label>
        <Select value={doctorId} onValueChange={setDoctorId}>
          <SelectTrigger id="doctor_id">
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>
            {doctors.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="appointment_at">
          {allDay ? 'Data' : 'Data e hora de início'}
        </Label>
        <Input
          id="appointment_at"
          type={allDay ? 'date' : 'datetime-local'}
          required
          value={allDay ? appointmentAt.slice(0, 10) : appointmentAt}
          onChange={(e) => {
            const v = e.target.value
            // Em modo allDay o input e' type=date (YYYY-MM-DD); guardamos
            // como ISO local "YYYY-MM-DDT00:00" para o formato unificado.
            setAppointmentAt(allDay && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00` : v)
          }}
        />
      </div>

      <div className="space-y-1.5">
        {!allDay ? (
          <>
            <Label htmlFor="end_time">Hora de fim</Label>
            <Input
              id="end_time"
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
            <p className="text-[11px] text-slate-500">
              Duração: <span className="font-bold tabular-nums">{durationMinutes} min</span>
            </p>
          </>
        ) : (
          <div className="flex h-full items-center text-xs text-slate-500">
            Ocupa o dia inteiro (00:00 às 23:59).
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <input
            id="all_day_appt"
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-primary"
          />
          <Label
            htmlFor="all_day_appt"
            className="cursor-pointer text-xs font-semibold text-slate-700"
          >
            Dia inteiro
          </Label>
        </div>
      </div>

      <ProcedurasEditor
        value={procedureLines}
        onChange={setProcedureLines}
        procedures={procedures}
        plans={plans}
        defaultPlanId={defaultPlanId}
        disabled={pending}
      />

      <div className="md:col-span-2">
        <MateriaisEditor value={materiais} onChange={setMateriais} disabled={pending} />
      </div>

      <div className="md:col-span-2">
        <AssistantMultiSelect
          options={liberalDoctors}
          value={assistants}
          onChange={setAssistants}
          disabled={pending}
        />
      </div>

      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="observacoes">Observações</Label>
        <Textarea
          id="observacoes"
          rows={3}
          maxLength={500}
          placeholder="Anotações sobre o atendimento (até 500 caracteres)"
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
        />
      </div>

      <div className="md:col-span-2 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/40 p-3">
        <input
          id="add_to_treatment_plan"
          type="checkbox"
          checked={addToTreatmentPlan}
          onChange={(e) => setAddToTreatmentPlan(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
        />
        <div className="flex-1">
          <Label
            htmlFor="add_to_treatment_plan"
            className="cursor-pointer text-sm font-semibold text-slate-800"
          >
            Adicionar ao plano de tratamento?
          </Label>
          <p className="text-[11px] text-slate-500">
            Cria uma etapa no plano de tratamento do paciente vinculada a este
            atendimento. Se já existir uma etapa pendente para o mesmo
            procedimento, ela será aproveitada automaticamente.
          </p>
        </div>
      </div>

      <div className="md:col-span-2 mt-2 rounded-lg border border-slate-200 bg-slate-50/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Pagamento
          </p>
          {procedureLines.some((p) => !p.planId || p.planId === '') ? (
            <span className="rounded-md bg-[hsl(var(--warning)/0.15)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--warning-foreground))]">
              Particular
            </span>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="payment_method">Método</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
            >
              <SelectTrigger id="payment_method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="installments_count">Parcelas</Label>
            <Input
              id="installments_count"
              type="number"
              min={1}
              max={60}
              value={installmentsCount}
              onChange={(e) => setInstallmentsCount(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment_status">Status</Label>
            <Select
              value={paymentStatus}
              onValueChange={(v) => setPaymentStatus(v as 'pago' | 'pendente')}
            >
              <SelectTrigger id="payment_status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pago">Pago</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {paymentStatus === 'pago' ? (
            <div className="space-y-1.5 md:col-span-3">
              <Label htmlFor="payment_paid_at">Data do pagamento</Label>
              <Input
                id="payment_paid_at"
                type="date"
                value={paymentPaidAt}
                onChange={(e) => setPaymentPaidAt(e.target.value)}
                className="md:max-w-xs"
              />
            </div>
          ) : null}
        </div>

        {/* Split de pagamento em N metodos (≤5) */}
        <div className="mt-3 border-t border-slate-200 pt-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={splitPayment}
              onChange={(e) => {
                setSplitPayment(e.target.checked)
                if (e.target.checked) setInstallmentsCount(1)
              }}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30"
            />
            <span>Dividir pagamento em múltiplos métodos</span>
            <span className="text-[10px] font-normal text-slate-500">
              (ex.: PIX + cartão + dinheiro)
            </span>
          </label>
          {splitPayment ? (
            <div className="mt-3 space-y-2 rounded-md bg-info-bg/30 p-3">
              {splitParts.map((part, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_auto]"
                >
                  <div className="space-y-1">
                    <Label htmlFor={`split_method_${idx}`} className="text-[11px]">
                      Método {idx + 1}
                    </Label>
                    <Select
                      value={part.method}
                      onValueChange={(v) => {
                        const next = [...splitParts]
                        next[idx] = { ...part, method: v as PaymentMethod }
                        setSplitParts(next)
                      }}
                    >
                      <SelectTrigger id={`split_method_${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {METHOD_OPTIONS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`split_percent_${idx}`} className="text-[11px]">
                      %
                    </Label>
                    <Input
                      id={`split_percent_${idx}`}
                      type="number"
                      min={1}
                      max={99}
                      value={part.percent}
                      onChange={(e) => {
                        const next = [...splitParts]
                        next[idx] = {
                          ...part,
                          percent: Math.max(1, Math.min(99, Number(e.target.value) || 1)),
                        }
                        setSplitParts(next)
                      }}
                    />
                  </div>
                  <div className="flex items-end">
                    {splitParts.length > 2 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 px-2 text-destructive"
                        onClick={() =>
                          setSplitParts(splitParts.filter((_, i) => i !== idx))
                        }
                        title="Remover método"
                      >
                        ×
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-info-text/10 pt-2">
                <span
                  className={
                    splitParts.reduce((s, p) => s + p.percent, 0) === 100
                      ? 'text-[11px] font-semibold text-success-text'
                      : 'text-[11px] font-semibold text-destructive'
                  }
                >
                  Soma:{' '}
                  {splitParts.reduce((s, p) => s + p.percent, 0)}% / 100%
                </span>
                {splitParts.length < MAX_SPLIT_PARTS ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() =>
                      setSplitParts([
                        ...splitParts,
                        { method: 'dinheiro', percent: 0 },
                      ])
                    }
                  >
                    + Adicionar método
                  </Button>
                ) : (
                  <span className="text-[10px] text-slate-500">
                    Máximo de {MAX_SPLIT_PARTS} métodos
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {!splitPayment && installmentsCount > 1 ? (
          <div className="mt-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Datas de vencimento
            </p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {installmentDates.map((d, i) => (
                <div key={i} className="space-y-1">
                  <Label htmlFor={`due_${i}`} className="text-[11px]">
                    Parcela {i + 1}
                  </Label>
                  <Input
                    id={`due_${i}`}
                    type="date"
                    value={d}
                    onChange={(e) => {
                      const next = [...installmentDates]
                      next[i] = e.target.value
                      setInstallmentDates(next)
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <p className="mt-3 text-[11px] text-slate-500">
          Total do pagamento = soma dos procedimentos.
        </p>
      </div>

      {conflictWarning ? (
        <div
          role="alert"
          className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
        >
          {conflictWarning}
        </div>
      ) : null}
      {error ? (
        <p className="md:col-span-2 text-sm text-destructive">{error}</p>
      ) : null}
      {warning ? (
        <p className="md:col-span-2 text-sm text-[hsl(var(--warning-foreground))]">{warning}</p>
      ) : null}

      <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-2">
        <Button
          type="submit"
          variant="outline"
          disabled={pending || !!conflictWarning}
          onClick={() => triggerSubmit('save')}
          title="Salva o atendimento como agendado. Pode ser confirmado ou cancelado depois."
        >
          {pending && activeAction === 'save' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Salvar
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !!conflictWarning}
          onClick={() => handleProtectedAction('confirm')}
          title="Salva e marca como confirmado (paciente avisou que vira). Acao irreversivel."
        >
          {pending && activeAction === 'confirm' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando…
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Salvar e confirmar
            </>
          )}
        </Button>
        <Button
          type="button"
          disabled={pending || !!conflictWarning}
          onClick={() => handleProtectedAction('realize')}
          title="Salva e registra que o paciente compareceu (marca como realizado). Acao irreversivel."
        >
          {pending && activeAction === 'realize' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando…
            </>
          ) : (
            <>
              <CheckCheck className="mr-2 h-4 w-4" />
              Salvar e confirmar presença
            </>
          )}
        </Button>
      </div>

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[hsl(var(--warning-foreground))]" />
              {confirmAction === 'realize'
                ? 'Confirmar presença do paciente?'
                : 'Confirmar agendamento?'}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === 'realize' ? (
                <>
                  Esta ação <strong>não é reversível</strong>. O atendimento será
                  criado e marcado como <strong>realizado</strong> imediatamente —
                  com impacto no plano de tratamento, comissões e financeiro.
                  Para desfazer depois é necessário <em>estorno financeiro</em>.
                </>
              ) : (
                <>
                  Esta ação <strong>não é reversível</strong>. O atendimento será
                  criado e marcado como <strong>confirmado</strong> (paciente
                  avisou que vai comparecer). Para desfazer depois só
                  cancelando o agendamento.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmAction(null)}
              disabled={pending}
            >
              Voltar
            </Button>
            <Button
              type="button"
              variant={confirmAction === 'realize' ? 'default' : 'secondary'}
              onClick={proceedAfterDialogConfirm}
              disabled={pending}
              className="gap-2"
            >
              {confirmAction === 'realize' ? (
                <>
                  <CheckCheck className="h-4 w-4" />
                  Sim, confirmar presença
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Sim, confirmar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}

function localIsoNow(): string {
  const d = new Date()
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function normalizeInitialAt(raw: string | undefined): string | null {
  if (!raw) return null
  const truncated = raw.length >= 16 ? raw.slice(0, 16) : raw
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(truncated)) return null
  return truncated
}

function addMinutesToHHMM(hhmm: string, minutes: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return '00:30'
  const total = parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10) + minutes
  const next = ((total % 1440) + 1440) % 1440
  const hh = Math.floor(next / 60)
  const mm = next % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function computeDurationMinutes(startDateTimeLocal: string, endHHMM: string): number {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})$/.exec(startDateTimeLocal)
  const e = /^(\d{2}):(\d{2})$/.exec(endHHMM)
  if (!m || !e) return 30
  const startMin = parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10)
  const endMin = parseInt(e[1] ?? '0', 10) * 60 + parseInt(e[2] ?? '0', 10)
  let diff = endMin - startMin
  if (diff <= 0) diff += 1440
  return diff
}

function computeEndIso(startDateTimeLocal: string, endHHMM: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(startDateTimeLocal)
  const e = /^(\d{2}):(\d{2})$/.exec(endHHMM)
  if (!m || !e) return null
  const datePart = m[1]
  const startMin = parseInt(m[2] ?? '0', 10) * 60 + parseInt(m[3] ?? '0', 10)
  const endMin = parseInt(e[1] ?? '0', 10) * 60 + parseInt(e[2] ?? '0', 10)
  let dayOffset = 0
  if (endMin <= startMin) dayOffset = 1
  const endDate = new Date(`${datePart}T${endHHMM}:00`)
  if (Number.isNaN(endDate.getTime())) return null
  if (dayOffset) endDate.setDate(endDate.getDate() + 1)
  return endDate.toISOString()
}

function clampDuration(n: number): number {
  if (!Number.isFinite(n)) return 30
  if (n < 5) return 5
  if (n > 480) return 480
  return Math.round(n)
}
