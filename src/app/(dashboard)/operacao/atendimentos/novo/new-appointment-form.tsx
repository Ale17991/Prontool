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

export interface FormOption {
  id: string
  label: string
}

export interface NewAppointmentFormProps {
  patients: FormOption[]
  doctors: FormOption[]
  procedures: FormOption[]
  plans: FormOption[]
}

export function NewAppointmentForm({
  patients,
  doctors,
  procedures,
  plans,
}: NewAppointmentFormProps) {
  const router = useRouter()
  const [patientId, setPatientId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [procedureId, setProcedureId] = useState('')
  const [planId, setPlanId] = useState('')
  const [appointmentAt, setAppointmentAt] = useState(() => localIsoNow())
  const [amountReais, setAmountReais] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sugere o valor vigente quando (plano, procedimento) mudam.
  useEffect(() => {
    if (!planId || !procedureId) return
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
  }, [planId, procedureId])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!patientId || !doctorId || !procedureId || !planId) {
      setError('Preencha paciente, profissional, procedimento e plano.')
      return
    }
    const whenIso = new Date(appointmentAt).toISOString()
    if (new Date(whenIso).getTime() > Date.now()) {
      setError('A data do atendimento não pode estar no futuro.')
      return
    }

    const payload: Record<string, unknown> = {
      patient_id: patientId,
      doctor_id: doctorId,
      procedure_id: procedureId,
      plan_id: planId,
      appointment_at: whenIso,
    }
    if (amountReais) {
      const cents = Math.round(Number(amountReais.replace(',', '.')) * 100)
      if (Number.isFinite(cents) && cents >= 0) {
        payload.amount_cents_override = cents
      }
    }
    if (observacoes.trim()) payload.observacoes = observacoes.trim().slice(0, 500)

    setPending(true)
    try {
      const res = await fetch('/api/atendimentos/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => ({}))) as {
        appointment_id?: string
        error?: { message?: string }
      }
      if (!res.ok || !body.appointment_id) {
        setError(body.error?.message ?? 'Falha ao registrar atendimento.')
        return
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
        <Select value={procedureId} onValueChange={setProcedureId}>
          <SelectTrigger id="procedure_id">
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>
            {procedures.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="plan_id">Plano</Label>
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
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="appointment_at">Data e hora</Label>
        <Input
          id="appointment_at"
          type="datetime-local"
          value={appointmentAt}
          onChange={(e) => setAppointmentAt(e.target.value)}
        />
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

      {error ? (
        <p className="md:col-span-2 text-sm text-rose-600">{error}</p>
      ) : null}

      <div className="md:col-span-2 flex items-center justify-end gap-2">
        <Button type="submit" disabled={pending}>
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
