'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  appointmentId: string
  /** Disparado após `router.refresh()` em caso de sucesso. Usado pelo painel
   *  lateral (feature 025) para re-fetch dos dados do atendimento. */
  onSuccess?: () => void
  /** Sinaliza ao caller que há request em andamento. Usado pelo guard de
   *  fechamento do painel lateral (feature 025) para evitar fechar enquanto
   *  uma ação está em curso. */
  onPendingChange?: (pending: boolean) => void
}

export function ConfirmAppointmentButton({
  appointmentId,
  onSuccess,
  onPendingChange,
}: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    setPending(true)
    onPendingChange?.(true)
    try {
      const res = await fetch(`/api/atendimentos/${appointmentId}/confirmar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(body.error?.message ?? `HTTP ${res.status}`)
      }
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
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={pending} className="gap-2">
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Confirmando…
          </>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Marcar como confirmado
          </>
        )}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
