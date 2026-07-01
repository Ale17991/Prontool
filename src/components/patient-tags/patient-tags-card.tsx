'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PatientTagsEditor, type PatientTag } from './patient-tags-editor'

interface PatientTagsCardProps {
  patientId: string
  /** Quando true, esconde o card vazio (sem tags e sem permissão de criar). */
  hideWhenEmpty?: boolean
}

/**
 * Card auto-contido para mostrar e editar tags de um paciente no
 * prontuário/quick view. Faz fetch das tags atribuídas ao montar.
 */
export function PatientTagsCard({ patientId }: PatientTagsCardProps) {
  const [tags, setTags] = useState<PatientTag[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(`/api/pacientes/${patientId}/tags`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((body: { tags: PatientTag[] }) => {
        if (active) setTags(body.tags ?? [])
      })
      .catch(() => {
        // silencioso — mostra editor vazio
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [patientId])

  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-xs">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tags</p>
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Carregando…
          </div>
        ) : (
          <PatientTagsEditor patientId={patientId} value={tags} onChange={setTags} />
        )}
      </CardContent>
    </Card>
  )
}
