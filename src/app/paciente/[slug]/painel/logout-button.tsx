'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PatientLogoutButton({ slug }: { slug: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function onLogout() {
    setPending(true)
    try {
      await fetch('/api/paciente/logout', { method: 'POST' })
    } finally {
      router.push(`/paciente/${slug}`)
      router.refresh()
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={onLogout} disabled={pending} className="gap-1.5">
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <LogOut className="h-3.5 w-3.5" />
      )}
      Sair
    </Button>
  )
}
