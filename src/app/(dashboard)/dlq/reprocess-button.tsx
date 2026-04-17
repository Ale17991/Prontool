'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ReprocessButton({ rawEventId }: { rawEventId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function onReprocess() {
    setPending(true)
    try {
      const res = await fetch(`/api/alertas/dlq/${rawEventId}/reprocess`, {
        method: 'POST',
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
      onClick={onReprocess}
      disabled={pending}
      style={{
        padding: '4px 10px',
        background: pending ? '#94a3b8' : '#2563eb',
        color: 'white',
        border: 'none',
        borderRadius: 4,
        cursor: pending ? 'wait' : 'pointer',
        fontSize: 12,
      }}
    >
      {pending ? '…' : 'Reprocessar'}
    </button>
  )
}
