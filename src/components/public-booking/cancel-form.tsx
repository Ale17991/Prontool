'use client'

import { useState } from 'react'
import Link from 'next/link'

interface CancelFormProps {
  slug: string
  token: string
}

export function CancelForm({ slug, token }: CancelFormProps) {
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clinicPhone, setClinicPhone] = useState<string | null>(null)

  async function onConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/public/booking/cancel/${encodeURIComponent(token)}`,
        { method: 'POST' },
      )
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const code = (json.error as string) ?? 'UNKNOWN'
        if (code === 'CANCEL_WINDOW_EXPIRED') {
          setClinicPhone((json.clinicPhone as string | null) ?? null)
          setError((json.message as string) ?? 'Janela de cancelamento expirou.')
        } else if (code === 'TOKEN_ALREADY_USED') {
          setError('Este agendamento já foi cancelado.')
        } else if (code === 'TOKEN_EXPIRED' || code === 'TOKEN_NOT_VALID') {
          setError('Link inválido ou expirado.')
        } else if (code === 'RATE_LIMITED') {
          setError('Muitas tentativas. Tente novamente em alguns minutos.')
        } else {
          setError(`Erro ao cancelar (${code}).`)
        }
        return
      }
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro de rede.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-success/30 bg-success-bg p-6 text-center">
          <h2 className="text-xl font-bold text-success-strong">
            Agendamento cancelado
          </h2>
          <p className="mt-2 text-sm text-success-text">
            O horário foi liberado. Se desejar, você pode agendar outro horário.
          </p>
        </div>
        <Link
          href={`/agendar/${slug}`}
          className="block w-full rounded-md bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Agendar novamente
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        Tem certeza que deseja cancelar este agendamento?
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <p>{error}</p>
          {clinicPhone && (
            <p className="mt-1 text-slate-900">
              Telefone: <strong>{clinicPhone}</strong>
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="flex-1 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Cancelando...' : 'Sim, cancelar'}
        </button>
        <Link
          href={`/agendar/${slug}`}
          className="flex-1 rounded-md border border-border bg-background px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-muted"
        >
          Voltar
        </Link>
      </div>
    </div>
  )
}
