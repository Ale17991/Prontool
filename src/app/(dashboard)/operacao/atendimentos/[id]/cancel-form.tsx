'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CancellationReason } from '@/lib/core/appointments/cancel'

const REASON_LABEL: Record<CancellationReason, string> = {
  no_show: 'Não compareceu (paciente faltou)',
  paciente_desmarcou: 'Paciente desmarcou',
  clinica_desmarcou: 'Clínica desmarcou',
  estornado: 'Estornado (cancelar após realizado)',
  outro: 'Outro',
}

interface Props {
  appointmentId: string
}

export function CancelAppointmentForm({ appointmentId }: Props) {
  const router = useRouter()
  const [reason, setReason] = useState<CancellationReason>('no_show')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/atendimentos/${appointmentId}/cancelar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason,
          notes: notes.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(body.error?.message ?? `HTTP ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="cancel_reason">Motivo</Label>
        <Select value={reason} onValueChange={(v) => setReason(v as CancellationReason)}>
          <SelectTrigger id="cancel_reason">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(REASON_LABEL) as CancellationReason[]).map((r) => (
              <SelectItem key={r} value={r}>
                {REASON_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cancel_notes">Observação (opcional)</Label>
        <Textarea
          id="cancel_notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Detalhes do cancelamento (até 500 caracteres)."
          rows={2}
          maxLength={500}
        />
      </div>
      {error ? (
        <p className="text-sm font-semibold text-destructive">{error}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="destructive" disabled={pending} className="gap-2">
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Cancelando…
            </>
          ) : (
            <>
              <X className="h-4 w-4" />
              Cancelar atendimento
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
