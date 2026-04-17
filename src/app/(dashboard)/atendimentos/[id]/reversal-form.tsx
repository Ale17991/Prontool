'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export function ReversalForm({ appointmentId }: { appointmentId: string }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
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
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
      <textarea
        required
        minLength={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo da reversão"
        style={{ padding: 8, border: '1px solid #cbd5e1', borderRadius: 4, minHeight: 80 }}
      />
      <button
        type="submit"
        disabled={pending || reason.trim().length < 3}
        style={{
          padding: '8px 14px',
          background: pending ? '#94a3b8' : '#b91c1c',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: pending ? 'wait' : 'pointer',
          justifySelf: 'start',
        }}
      >
        {pending ? 'Registrando…' : 'Registrar reversão'}
      </button>
      {error ? <p style={{ color: '#b91c1c', fontSize: 13 }}>{error}</p> : null}
    </form>
  )
}
