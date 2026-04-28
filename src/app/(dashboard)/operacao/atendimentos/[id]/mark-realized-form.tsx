'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Botao "Marcar realizado" para atendimentos agendados. Cria uma
 * appointment_completion (append-only) que:
 *   - faz a view appointments_effective retornar status 'ativo'
 *   - sincroniza a etapa vinculada do plano de tratamento (concluido)
 */
export function MarkRealizedForm({ appointmentId }: { appointmentId: string }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/atendimentos/${appointmentId}/realizado`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reason.trim().length > 0 ? { reason: reason.trim() } : {}),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      router.refresh()
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-xl gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="realized_reason">Observação (opcional)</Label>
        <Textarea
          id="realized_reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: Realizado conforme planejado."
          rows={2}
          maxLength={500}
        />
      </div>
      {error ? (
        <p className="text-sm font-semibold text-rose-700">{error}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="gap-2">
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Marcando…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Marcar realizado
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
