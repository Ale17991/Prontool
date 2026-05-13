'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function MarkAllButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function onClick() {
    if (pending) return
    setPending(true)
    try {
      await fetch('/api/notificacoes/mark-all-read', { method: 'POST' })
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={pending} className="gap-1.5">
      <CheckCheck className="h-3.5 w-3.5" />
      {pending ? 'Marcando…' : 'Marcar todas como lidas'}
    </Button>
  )
}
