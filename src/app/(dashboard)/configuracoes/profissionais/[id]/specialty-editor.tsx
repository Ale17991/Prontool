'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { SpecialtySelect } from '../specialty-select'

/**
 * Editor da especialidade do médico — fonte ÚNICA (catálogo Memed). Grava em
 * doctors.specialty (PATCH), que alimenta o cabeçalho e a prescrição digital.
 * Salva ao trocar a seleção.
 */
export function SpecialtyEditor({
  doctorId,
  current,
}: {
  doctorId: string
  current: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(current ?? '')
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function save(next: string) {
    setValue(next)
    setSaved(false)
    setError(null)
    start(async () => {
      try {
        const res = await fetch(`/api/medicos/${doctorId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ specialty: next || null }),
        })
        if (!res.ok) {
          setError('Não foi possível salvar a especialidade.')
          return
        }
        setSaved(true)
        router.refresh()
      } catch {
        setError('Erro de rede.')
      }
    })
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <SpecialtySelect id="doctor-specialty" value={value} onChange={save} disabled={pending} />
        {pending ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
        ) : saved ? (
          <Check className="h-4 w-4 shrink-0 text-success-strong" />
        ) : null}
      </div>
      <p className="text-[11px] text-slate-400">
        Do catálogo da Memed — alimenta o cabeçalho e a prescrição digital.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
