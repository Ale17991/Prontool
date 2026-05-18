'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Power } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function TemplateActiveToggle({
  templateId,
  currentActive,
  title,
}: {
  templateId: string
  currentActive: boolean
  title: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    const action = currentActive ? 'desativar' : 'reativar'
    if (
      !confirm(
        `Tem certeza que quer ${action} o modelo "${title}"?\n\n` +
          (currentActive
            ? 'Modelos inativos não aparecem para serem aplicados a pacientes. Anamneses já preenchidas continuam intactas.'
            : 'O modelo voltará a aparecer na lista de modelos disponíveis.'),
      )
    ) {
      return
    }
    setError(null)
    const res = await fetch(`/api/anamnesis-templates/${templateId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: !currentActive }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string }
      }
      setError(body.error?.message ?? `Falha ao ${action} modelo.`)
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() => void toggle()}
        disabled={pending}
        className="h-7 gap-1 px-2 text-[11px]"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : currentActive ? (
          <Power className="h-3 w-3 text-destructive" />
        ) : (
          <CheckCircle2 className="h-3 w-3 text-success-strong" />
        )}
        {currentActive ? 'Desativar' : 'Reativar'}
      </Button>
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
    </div>
  )
}
