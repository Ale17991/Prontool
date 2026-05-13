'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/**
 * Feature 008 — Botão "Desconectar" como Client Component porque precisa
 * fazer DELETE via fetch e atualizar a página.
 */
export function GhlDisconnectButton(): JSX.Element {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    if (
      !window.confirm(
        'Desconectar a integração Homio? Os dados clínicos do tenant ficam preservados, mas a sincronização para de funcionar até reconectar.',
      )
    ) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/configuracoes/integracoes/ghl', {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string }
        }
        setError(body.error?.message ?? `Erro ${res.status}`)
        return
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro de rede')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="destructive" onClick={handleClick} disabled={submitting}>
        {submitting ? 'Desconectando…' : 'Desconectar'}
      </Button>
      {error ? (
        <span className="text-xs text-rose-600">{error}</span>
      ) : null}
    </div>
  )
}
