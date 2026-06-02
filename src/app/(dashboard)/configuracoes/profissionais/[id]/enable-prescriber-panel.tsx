'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

type PrescriberStatus = 'none' | 'pending' | 'registered' | 'error'

interface Specialty {
  id: string
  nome: string
}

interface ApiError {
  error?: { code?: string; message?: string }
}

export function EnablePrescriberPanel({
  doctorId,
  memedConnected,
  hasRequiredFields,
  initialStatus,
  initialSpecialtyId,
  lastError,
}: {
  doctorId: string
  memedConnected: boolean
  hasRequiredFields: boolean
  initialStatus: PrescriberStatus
  initialSpecialtyId: string | null
  lastError: string | null
}): JSX.Element {
  const router = useRouter()
  const [specialties, setSpecialties] = useState<Specialty[]>([])
  const [specialtyId, setSpecialtyId] = useState<string>(initialSpecialtyId ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!memedConnected) return
    let cancelled = false
    fetch('/api/integracoes/memed/especialidades')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { especialidades?: Specialty[] }) => {
        if (!cancelled) setSpecialties(data.especialidades ?? [])
      })
      .catch(() => {
        /* catálogo indisponível — segue sem seletor */
      })
    return () => {
      cancelled = true
    }
  }, [memedConnected])

  async function handleEnable() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/medicos/${doctorId}/memed-prescritor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memed_specialty_id: specialtyId || null }),
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

      <div className="space-y-1.5">
        <Label htmlFor="memed-specialty">Especialidade (opcional)</Label>
        <select
          id="memed-specialty"
          value={specialtyId}
          onChange={(e) => setSpecialtyId(e.target.value)}
          disabled={specialties.length === 0}
          className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">— sem especialidade —</option>
          {specialties.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
        {specialties.length === 0 ? (
          <p className="text-[11px] text-slate-400">Catálogo de especialidades indisponível no momento.</p>
        ) : null}
      </div>

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
