'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SoftDeleteExpenseButton({ id }: { id: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Remover esta despesa? O registro vai para soft-delete e permanece na trilha de auditoria.',
      )
    ) {
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/despesas/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        setError('Falha ao remover.')
        return
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error ? <span className="text-[10px] font-medium text-rose-600">{error}</span> : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleDelete}
        disabled={loading}
        className="h-8 w-8 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
        aria-label="Remover despesa"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  )
}
