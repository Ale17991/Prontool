'use client'

import { useState, useTransition } from 'react'
import { BellOff, BellRing } from 'lucide-react'
import { setPatientReminderOptIn } from '@/app/(dashboard)/configuracoes/lembretes/actions'

interface RemindersOptInToggleProps {
  patientId: string
  initialOptIn: boolean
  /** Se o admin tem permissão para alternar; false = render read-only. */
  canEdit: boolean
}

export function RemindersOptInToggle({
  patientId,
  initialOptIn,
  canEdit,
}: RemindersOptInToggleProps) {
  const [pending, startTransition] = useTransition()
  const [optIn, setOptIn] = useState(initialOptIn)
  const [error, setError] = useState<string | null>(null)

  function toggle() {
    if (!canEdit || pending) return
    const next = !optIn
    setError(null)
    setOptIn(next) // optimistic
    startTransition(async () => {
      const result = await setPatientReminderOptIn(patientId, next)
      if (!result.ok) {
        setOptIn(!next) // revert
        setError(`Erro ao salvar (${result.error})`)
      }
    })
  }

  const Icon = optIn ? BellRing : BellOff
  const label = optIn ? 'Recebe lembretes' : 'Opt-out de lembretes'
  const hint = optIn
    ? 'Lembretes automáticos habilitados para este paciente.'
    : 'Paciente NÃO receberá lembretes automáticos (opt-out).'

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={
              optIn
                ? 'rounded-lg bg-success-bg p-2 text-success-strong'
                : 'rounded-lg bg-muted p-2 text-slate-500'
            }
          >
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">{label}</div>
            <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '...' : optIn ? 'Desabilitar' : 'Habilitar'}
          </button>
        ) : null}
      </div>
      {error && (
        <div role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}
