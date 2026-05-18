'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onResolve}
      disabled={pending}
      className="text-success-strong hover:bg-success-bg hover:text-success-text"
    >
      <Check className="mr-1 h-3 w-3" />
      {pending ? '…' : 'Resolver'}
    </Button>
  )
}
