'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface Props {
  id: string
  status: 'pendente' | 'concluida'
  isAdmin: boolean
}

export function TaskRowActions({ id, status, isAdmin }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function patch(body: unknown) {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/tarefas/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const p = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(p.error?.message ?? `HTTP ${res.status}`)
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
      <div className="flex items-center gap-1">
        {status === 'pendente' ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => patch({ status: 'concluida' })}
            disabled={pending}
          >
            Concluir
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => patch({ status: 'pendente' })}
            disabled={pending}
          >
            Reabrir
          </Button>
        )}
        {isAdmin ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm('Remover esta tarefa?')) {
                void patch({ soft_delete: true })
              }
            }}
            disabled={pending}
            className="text-rose-600 hover:text-rose-700"
          >
            Remover
          </Button>
        ) : null}
      </div>
      {error ? (
        <span className="text-[10px] text-rose-600" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  )
}
