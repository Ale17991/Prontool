'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ResolveButton({ alertId }: { alertId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function onResolve() {
    setPending(true)
    try {
      const res = await fetch(`/api/alertas/${alertId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onResolve}
      disabled={pending}
      style={{
        padding: '4px 10px',
        background: pending ? '#94a3b8' : '#16a34a',
        color: 'white',
        border: 'none',
        borderRadius: 4,
        cursor: pending ? 'wait' : 'pointer',
        fontSize: 12,
      }}
    >
      {pending ? '…' : 'Resolver'}
    </button>
  )
}
