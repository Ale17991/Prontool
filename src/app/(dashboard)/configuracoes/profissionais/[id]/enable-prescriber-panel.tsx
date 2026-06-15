'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type PrescriberStatus = 'none' | 'pending' | 'registered' | 'error'

interface ApiError {
  error?: { code?: string; message?: string }
}

export function EnablePrescriberPanel({
  doctorId,
  memedConnected,
  hasRequiredFields,
  initialStatus,
  currentSpecialty,
  lastError,
}: {
  doctorId: string
  memedConnected: boolean
  hasRequiredFields: boolean
  initialStatus: PrescriberStatus
  /** Especialidade do médico (doctors.specialty) — fonte única, reaproveitada. */
  currentSpecialty: string | null
  lastError: string | null
}): JSX.Element {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEnable() {
    setSubmitting(true)
    setError(null)
    try {
      // A especialidade vem de doctors.specialty (resolvida no servidor) —
      // não enviamos id aqui; o backend deriva do catálogo.
      const res = await fetch(`/api/medicos/${doctorId}/memed-prescritor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError
        setError(body.error?.message ?? `Erro ${res.status}`)
        return
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro de rede')
    } finally {
      setSubmitting(false)
    }
  }

  if (!memedConnected) {
    return (
      <p className="text-sm text-slate-600">
        Conecte a clínica à Memed em{' '}
        <Link href="/configuracoes/integracoes/memed" className="font-semibold text-primary hover:underline">
          Integrações → Memed
        </Link>{' '}
        para habilitar prescritores.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">Status:</span>
        {renderStatusBadge(initialStatus)}
      </div>

      {initialStatus === 'error' && lastError ? (
        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5" /> {lastError}
        </p>
      ) : null}

      {!hasRequiredFields ? (
        <p className="rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] p-2 text-xs text-[hsl(var(--warning-foreground))]">
          Complete <strong>CPF, conselho + UF e data de nascimento</strong> no card acima antes de
          habilitar a prescrição digital.
        </p>
      ) : null}

      <p className="text-xs text-slate-500">
        Especialidade:{' '}
        <span className="font-semibold text-slate-700">
          {currentSpecialty || '— não definida —'}
        </span>{' '}
        <span className="text-slate-400">
          (definida no card “Especialidade” acima; usada na prescrição)
        </span>
      </p>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <Button onClick={handleEnable} disabled={submitting || !hasRequiredFields} size="sm" className="gap-2">
        {initialStatus === 'registered' ? <CheckCircle2 className="h-4 w-4" /> : null}
        {submitting
          ? 'Enviando…'
          : initialStatus === 'registered'
            ? 'Re-sincronizar prescritor'
            : 'Habilitar como prescritor'}
      </Button>
    </div>
  )
}

function renderStatusBadge(status: PrescriberStatus): JSX.Element {
  switch (status) {
    case 'registered':
      return <Badge variant="success">Habilitado</Badge>
    case 'pending':
      return <Badge variant="secondary">Pendente</Badge>
    case 'error':
      return <Badge variant="destructive">Erro</Badge>
    case 'none':
    default:
      return <Badge variant="secondary">Não habilitado</Badge>
  }
}
