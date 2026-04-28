'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import {
  LocalProcedureTypeahead,
  type LocalProcedureOption,
} from '@/components/tuss/local-procedure-typeahead'

export interface FormOption {
  id: string
  label: string
}

export interface PatientFormOption extends FormOption {
  /** Plano de saude do paciente; null = paciente particular sempre. */
  planId: string | null
}

export interface NewAppointmentFormProps {
  patients: PatientFormOption[]
  doctors: FormOption[]
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
  patients,
  doctors,
  procedures,
  plans,
  initialAppointmentAt,
}: NewAppointmentFormProps) {
  const router = useRouter()
  const [patientId, setPatientId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [procedureId, setProcedureId] = useState('')
  const [planId, setPlanId] = useState('')
  const [particular, setParticular] = useState(false)
  const [particularLocked, setParticularLocked] = useState(false)
  const [particularUserOverride, setParticularUserOverride] = useState(false)
  const [appointmentAt, setAppointmentAt] = useState(
    () => normalizeInitialAt(initialAppointmentAt) ?? localIsoNow(),
  )
  const [endTime, setEndTime] = useState<string>(() => {
    // default = início + 30 min
    const start = normalizeInitialAt(initialAppointmentAt) ?? localIsoNow()
    return addMinutesToHHMM(start.slice(11), 30)
  })
  const [amountReais, setAmountReais] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [conflictWarning, setConflictWarning] = useState<string | null>(null)

  // Duracao derivada de start/end.
  const durationMinutes = computeDurationMinutes(appointmentAt, endTime)

  // Pagamento
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [installmentsCount, setInstallmentsCount] = useState<number>(1)
  const [installmentDates, setInstallmentDates] = useState<string[]>([])
  const [paymentStatus, setPaymentStatus] = useState<'pago' | 'pendente'>('pago')
  const [paymentPaidAt, setPaymentPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  )

  // Auto-detect "Atendimento particular":
  //   - procedimento com covered_by_plan = false → forca particular (lock).
  //   - paciente sem plano → particular default (sem lock; user pode mudar).
  //   - paciente com plano + procedimento coberto → desmarcado (default).
  // Override manual do user prevalece (sai do auto-detect).
  useEffect(() => {
    const selectedPatient = patients.find((p) => p.id === patientId)
    const selectedProcedure = procedures.find((p) => p.id === procedureId)

    // Lock: procedimento nao coberto sempre forca particular.
    if (selectedProcedure && selectedProcedure.coveredByPlan === false) {
      setParticular(true)
      setParticularLocked(true)
      setParticularUserOverride(false)
      return
    }
    setParticularLocked(false)

    // Sem override manual, deduz pelo paciente.
    if (particularUserOverride) return
    if (!selectedPatient) {
      setParticular(false)
      return
    }
    setParticular(selectedPatient.planId === null)
  }, [patientId, procedureId, patients, procedures, particularUserOverride])

  // Pre-seleciona plano do paciente quando aplicavel.
  useEffect(() => {
    if (particular || planId) return
    const selectedPatient = patients.find((p) => p.id === patientId)
    if (selectedPatient?.planId) setPlanId(selectedPatient.planId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, particular])

  // Recalcula datas das parcelas quando o número muda.
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

  // Sugere o valor:
  //   - Convenio (planId presente, !particular): busca /api/precos/vigente
  //   - Particular: usa procedure.defaultAmountCents
  useEffect(() => {
    if (!procedureId) return
    if (particular) {
      const proc = procedures.find((p) => p.id === procedureId)
      if (proc?.defaultAmountCents !== null && proc?.defaultAmountCents !== undefined && amountReais === '') {
        setAmountReais((proc.defaultAmountCents / 100).toFixed(2))
      }
      return
    }
    if (!planId) return
    ;(async () => {
      try {
        const params = new URLSearchParams({
          plan_id: planId,
          procedure_id: procedureId,
        })
        const res = await fetch(`/api/precos/vigente?${params.toString()}`)
        if (!res.ok) return
        const body = (await res.json()) as { amountCents?: number | null }
        if (typeof body.amountCents === 'number' && amountReais === '') {
          setAmountReais((body.amountCents / 100).toFixed(2))
        }
      } catch {
        /* sugestão best-effort — ignora */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, procedureId, particular])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!patientId || !doctorId || !procedureId) {
      setError('Preencha paciente, profissional e procedimento.')
      return
    }
    if (!particular && !planId) {
      setError('Selecione o plano de saude ou marque "Atendimento particular".')
      return
    }
    if (particular) {
      const proc = procedures.find((p) => p.id === procedureId)
      const overrideValid =
        amountReais.trim().length > 0 &&
        Number(amountReais.replace(',', '.').replace(/\./g, '')) > 0
      if ((proc?.defaultAmountCents === null || proc?.defaultAmountCents === undefined || proc.defaultAmountCents <= 0) && !overrideValid) {
        setError(
          'Valor particular não cadastrado para este procedimento. Informe o valor manualmente.',
        )
        return
      }
    }
    const whenIso = new Date(appointmentAt).toISOString()
    const endIso = computeEndIso(appointmentAt, endTime)
    if (!endIso || new Date(endIso).getTime() <= new Date(whenIso).getTime()) {
      setError('Hora de fim deve ser depois do início.')
      return
    }
    if (conflictWarning) {
      setError(conflictWarning + ' Ajuste o horário antes de salvar.')
      return
    }
    // Datas futuras sao permitidas — o atendimento entra como 'agendado'
    // na agenda e migra para 'ativo' automaticamente quando o horario chega.

    const payload: Record<string, unknown> = {
      patient_id: patientId,
      doctor_id: doctorId,
      procedure_id: procedureId,
      plan_id: particular ? null : planId,
      appointment_at: whenIso,
      duration_minutes: clampDuration(durationMinutes),
    }
    if (amountReais) {
      const cents = Math.round(Number(amountReais.replace(',', '.')) * 100)
      if (Number.isFinite(cents) && cents >= 0) {
        payload.amount_cents_override = cents
      }
    }
    if (observacoes.trim()) payload.observacoes = observacoes.trim().slice(0, 500)

    setPending(true)
    setWarning(null)
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

      // Cria pagamento associado ao atendimento.
      const totalCents =
        amountReais.trim().length > 0
          ? Math.round(Number(amountReais.replace(',', '.')) * 100)
          : null
      if (totalCents !== null && totalCents > 0) {
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
            paid_at:
              paymentStatus === 'pago'
                ? new Date(paymentPaidAt).toISOString()
                : null,
          }),
        })
        if (!payRes.ok) {
          const payBody = (await payRes.json().catch(() => ({}))) as {
            error?: { message?: string }
          }
          // Atendimento já foi salvo — não bloqueia, mas avisa.
          setWarning(
            `Atendimento salvo, mas o pagamento falhou: ${payBody.error?.message ?? 'erro desconhecido'}. Registre manualmente em /operacao/pacientes/${patientId}.`,
          )
        }
      }

      router.push(`/operacao/atendimentos/${body.appointment_id}`)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="patient_id">Paciente</Label>
        <Select value={patientId} onValueChange={setPatientId}>
          <SelectTrigger id="patient_id">
            <SelectValue placeholder="Selecione um paciente…" />
          </SelectTrigger>
          <SelectContent>
            {patients.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        <Label htmlFor="procedure_id">Procedimento (TUSS)</Label>
        <LocalProcedureTypeahead
          id="procedure_id"
          options={procedures}
          value={procedureId}
          onChange={setProcedureId}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="plan_id">Plano</Label>
        <label className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-900">
          <input
            type="checkbox"
            checked={particular}
            disabled={particularLocked}
            onChange={(e) => {
              setParticular(e.target.checked)
              setParticularUserOverride(true)
            }}
            className="h-4 w-4 rounded border-amber-300"
          />
          <span>
            <span className="font-bold">Atendimento particular</span>
            {particularLocked ? (
              <span className="ml-1 text-amber-700">
                (procedimento não coberto por plano)
              </span>
            ) : null}
          </span>
        </label>
        {particular ? null : (
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger id="plan_id">
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              {plans.map((hp) => (
                <SelectItem key={hp.id} value={hp.id}>
                  {hp.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="appointment_at">Data e hora de início</Label>
        <Input
          id="appointment_at"
          type="datetime-local"
          required
          value={appointmentAt}
          onChange={(e) => setAppointmentAt(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
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
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="amount">Valor (R$)</Label>
        <Input
          id="amount"
          inputMode="decimal"
          placeholder="0,00"
          value={amountReais}
          onChange={(e) => setAmountReais(e.target.value)}
        />
        <p className="text-[11px] text-slate-500">
          Deixe vazio para usar o preço vigente. Editar aqui sobrescreve o valor congelado.
        </p>
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

      <div className="md:col-span-2 mt-2 rounded-lg border border-slate-200 bg-slate-50/40 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Pagamento
        </p>
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

        {installmentsCount > 1 ? (
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
          Se o valor estiver vazio, o pagamento NÃO é registrado — só o atendimento.
        </p>
      </div>

      {conflictWarning ? (
        <div
          role="alert"
          className="md:col-span-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
        >
          {conflictWarning}
        </div>
      ) : null}
      {error ? (
        <p className="md:col-span-2 text-sm text-rose-600">{error}</p>
      ) : null}
      {warning ? (
        <p className="md:col-span-2 text-sm text-amber-700">{warning}</p>
      ) : null}

      <div className="md:col-span-2 flex items-center justify-end gap-2">
        <Button type="submit" disabled={pending || !!conflictWarning}>
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Registrar atendimento
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

function localIsoNow(): string {
  // Datetime-local input expects "YYYY-MM-DDTHH:MM" (no seconds, no Z).
  const d = new Date()
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function normalizeInitialAt(raw: string | undefined): string | null {
  if (!raw) return null
  // Aceita tanto "YYYY-MM-DDTHH:MM" quanto ISO completo com offset.
  const truncated = raw.length >= 16 ? raw.slice(0, 16) : raw
  // Validacao basica de formato.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(truncated)) return null
  return truncated
}

function addMinutesToHHMM(hhmm: string, minutes: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return '00:30'
  const total = parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10) + minutes
  const norm = ((total % 1440) + 1440) % 1440
  const hh = `${Math.floor(norm / 60)}`.padStart(2, '0')
  const mm = `${norm % 60}`.padStart(2, '0')
  return `${hh}:${mm}`
}

function computeDurationMinutes(startDateTime: string, endHHMM: string): number {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})$/.exec(startDateTime)
  const e = /^(\d{2}):(\d{2})$/.exec(endHHMM)
  if (!m || !e) return 30
  const startMin = parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10)
  const endMin = parseInt(e[1] ?? '0', 10) * 60 + parseInt(e[2] ?? '0', 10)
  let diff = endMin - startMin
  if (diff <= 0) diff += 1440 // cruza meia-noite
  return diff
}

function computeEndIso(startDateTimeLocal: string, endHHMM: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(startDateTimeLocal)
  const e = /^(\d{2}):(\d{2})$/.exec(endHHMM)
  if (!m || !e) return null
  // ISO local "YYYY-MM-DDTHH:MM" → Date local → ISO UTC.
  const datePart = m[1]
  const startTime = `${m[2]}:${m[3]}`
  const startMin = parseInt(m[2] ?? '0', 10) * 60 + parseInt(m[3] ?? '0', 10)
  const endMin = parseInt(e[1] ?? '0', 10) * 60 + parseInt(e[2] ?? '0', 10)
  let dayOffset = 0
  if (endMin <= startMin) dayOffset = 1
  const endDate = new Date(`${datePart}T${endHHMM}:00`)
  if (Number.isNaN(endDate.getTime())) return null
  if (dayOffset) endDate.setDate(endDate.getDate() + 1)
  // ignore startTime — only used to detect day rollover
  void startTime
  return endDate.toISOString()
}

function clampDuration(n: number): number {
  if (!Number.isFinite(n)) return 30
  if (n < 5) return 5
  if (n > 480) return 480
  return Math.round(n)
}
