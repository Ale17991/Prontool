'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  appointmentId: string
  /** Painel lateral (feature 025): re-fetch após sucesso. */
  onSuccess?: () => void
  /** Painel lateral: sinaliza form sujo (motivo digitado) ao Host. */
  onDirtyChange?: (dirty: boolean) => void
  /** Painel lateral: sinaliza request em andamento. */
  onPendingChange?: (pending: boolean) => void
}

export function ReversalForm({
  appointmentId,
  onSuccess,
  onDirtyChange,
  onPendingChange,
}: Props) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleReasonChange(value: string) {
    const wasDirty = reason.length > 0
    const isDirty = value.length > 0
    setReason(value)
    if (wasDirty !== isDirty) onDirtyChange?.(isDirty)
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    onPendingChange?.(true)
    try {
      const res = await fetch(`/api/atendimentos/${appointmentId}/reversal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      setReason('')
      onDirtyChange?.(false)
      router.refresh()
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
      onPendingChange?.(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="reason">Motivo do cancelamento</Label>
        <Textarea
          id="reason"
          required
          minLength={3}
          value={reason}
          onChange={(e) => handleReasonChange(e.target.value)}
          placeholder="Descreva o motivo (paciente faltou, erro de cobrança, etc.)"
          className="min-h-[100px]"
        />
      </div>
      <Button
        type="submit"
        variant="destructive"
        disabled={pending || reason.trim().length < 3}
        className="justify-self-start"
      >
        {pending ? 'Cancelando…' : 'Cancelar atendimento'}
      </Button>
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}
