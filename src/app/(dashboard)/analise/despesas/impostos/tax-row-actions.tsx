'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EditTaxForm } from './edit-tax-form'

interface TaxRowActionsProps {
  id: string
  name: string
  ratePercent: string
  description: string | null
  isActive: boolean
}

export function TaxRowActions(props: TaxRowActionsProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onToggleActive() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/impostos/${props.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active: !props.isActive }),
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
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(true)}
          disabled={pending}
        >
          Editar
        </Button>
        <Button
          type="button"
          variant={props.isActive ? 'outline' : 'default'}
          size="sm"
          onClick={onToggleActive}
          disabled={pending}
        >
          {pending ? '…' : props.isActive ? 'Desativar' : 'Reativar'}
        </Button>
      </div>
      {error ? (
        <span className="text-[10px] text-destructive" title={error}>
          Erro: {error}
        </span>
      ) : null}
      {editing ? (
        <EditTaxForm
          id={props.id}
          name={props.name}
          initialRatePercent={props.ratePercent}
          initialDescription={props.description}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}
