'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export function ToggleActiveDoctor({ doctorId, active }: { doctorId: string; active: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/medicos/${doctorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !active }),
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
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={active ? 'outline' : 'default'}
        size="sm"
        onClick={onClick}
        disabled={pending}
      >
        {pending ? '…' : active ? 'Desativar' : 'Ativar'}
      </Button>
      {error ? (
        <span className="text-[10px] text-rose-600" title={error}>
          Erro
        </span>
      ) : null}
    </div>
  )
}
