'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface DoctorOption {
  id: string
  fullName: string
}

interface Props {
  doctors: DoctorOption[]
  defaultDate: string
  defaultDoctorId: string | null
}

interface Conflict {
  appointmentId: string
  appointmentAt: string
}

export function ScheduleBlockForm({ doctors, defaultDate, defaultDoctorId }: Props) {
  const router = useRouter()
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? '')
  const [blockDate, setBlockDate] = useState(defaultDate)
  const [allDay, setAllDay] = useState(false)
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('12:00')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null)
  const [confirmedDespiteConflicts, setConfirmedDespiteConflicts] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!doctorId) {
      setError('Selecione um profissional.')
      return
    }
    if (!blockDate) {
      setError('Informe a data.')
      return
    }
    if (!reason.trim() || reason.trim().length < 2) {
      setError('Informe o motivo do bloqueio.')
      return
    }
    if (!allDay && (!startTime || !endTime)) {
      setError('Informe os horários de início e fim.')
      return
    }
    if (!allDay && endTime <= startTime) {
      setError('Hora de fim deve ser depois do início.')
      return
    }

    setPending(true)
    try {
      const res = await fetch('/api/agenda/bloqueios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          doctor_id: doctorId,
          block_date: blockDate,
          all_day: allDay,
          start_time: allDay ? null : startTime,
          end_time: allDay ? null : endTime,
          reason: reason.trim(),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        id?: string
        conflicts?: Conflict[]
        error?: { message?: string }
      }
      if (!res.ok || !body.id) {
        setError(body.error?.message ?? 'Falha ao criar bloqueio.')
        return
      }

      // Conflitos sao informativos — bloqueio foi criado mesmo com
      // sobreposicao. Se houver, mostramos resumo e pedimos confirmacao
      // visual antes de navegar.
      if (body.conflicts && body.conflicts.length > 0 && !confirmedDespiteConflicts) {
        setConflicts(body.conflicts)
        setConfirmedDespiteConflicts(true)
        return
      }

      router.push(`/operacao/atendimentos?date=${blockDate}`)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="doctor_id">Profissional</Label>
        <Select value={doctorId} onValueChange={setDoctorId}>
          <SelectTrigger id="doctor_id">
            <SelectValue placeholder="Selecione um profissional…" />
          </SelectTrigger>
          <SelectContent>
            {doctors.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="block_date">Data</Label>
        <Input
          id="block_date"
          type="date"
          required
          value={blockDate}
          onChange={(e) => setBlockDate(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2 pt-6">
          <input
            id="all_day"
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-primary"
          />
          <Label htmlFor="all_day" className="cursor-pointer text-sm font-semibold">
            Dia inteiro
          </Label>
        </div>
      </div>

      {!allDay ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="start_time">Horário de início</Label>
            <Input
              id="start_time"
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="end_time">Horário de fim</Label>
            <Input
              id="end_time"
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </>
      ) : null}

      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="reason">Motivo / Ocasião</Label>
        <Input
          id="reason"
          maxLength={200}
          placeholder="Ex: Reunião, Curso, Férias, Manutenção, Pessoal"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {conflicts && conflicts.length > 0 ? (
        <div className="md:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="h-4 w-4" />
            {conflicts.length === 1
              ? '1 atendimento existente neste horário.'
              : `${conflicts.length} atendimentos existentes neste horário.`}
          </p>
          <p className="mt-1 text-xs">
            O bloqueio foi criado mesmo assim e ja aparece na agenda como
            indicativo (fundo amarelo nos atendimentos).
          </p>
        </div>
      ) : null}

      {error ? <p className="md:col-span-2 text-sm text-rose-600">{error}</p> : null}

      <div className="md:col-span-2 flex items-center justify-end gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando…
            </>
          ) : (
            <>
              <Lock className="mr-2 h-4 w-4" />
              Bloquear horário
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
