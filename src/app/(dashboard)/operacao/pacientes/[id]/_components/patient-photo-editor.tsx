'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2, Upload, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const MAX_BYTES = 3 * 1024 * 1024

/**
 * Backlog 1/1 — foto na ficha do paciente. Upload/substituição/remoção via
 * /api/pacientes/[id]/foto. Aparece no cabeçalho do paciente após salvar.
 */
export function PatientPhotoEditor({
  patientId,
  photoUrl,
  canEdit,
}: {
  patientId: string
  photoUrl: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onPick(file: File) {
    setError(null)
    if (file.size > MAX_BYTES) {
      setError('A foto excede 3 MB.')
      return
    }
    setPending(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/pacientes/${patientId}/foto`, { method: 'POST', body: fd })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao enviar a foto.')
        return
      }
      router.refresh()
    } finally {
      setPending(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function onRemove() {
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/foto`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        setError('Falha ao remover a foto.')
        return
      }
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-primary" />
          Foto do paciente
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="Foto do paciente" className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <User className="h-8 w-8" />
          </div>
        )}
        {canEdit ? (
          <div className="space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onPick(f)
              }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => inputRef.current?.click()}
                className="gap-2"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {photoUrl ? 'Trocar foto' : 'Enviar foto'}
              </Button>
              {photoUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={onRemove}
                  className="gap-2 text-destructive"
                >
                  <Trash2 className="h-4 w-4" /> Remover
                </Button>
              ) : null}
            </div>
            {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
            <p className="text-[11px] text-slate-400">JPG ou PNG, até 3 MB.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
