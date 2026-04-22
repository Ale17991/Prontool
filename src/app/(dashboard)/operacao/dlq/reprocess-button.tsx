'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
    <Button type="button" size="sm" variant="outline" onClick={onReprocess} disabled={pending}>
      <RotateCw className={pending ? 'mr-1 h-3 w-3 animate-spin' : 'mr-1 h-3 w-3'} />
      {pending ? '…' : 'Reprocessar'}
    </Button>
  )
}
