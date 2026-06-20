'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Tag, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const MAX_BYTES = 5 * 1024 * 1024

interface AttRow {
  id: string
  fileName: string
  uploadedAt: string
  signedUrl: string | null
}

/**
 * Backlog 1/4 — fotos das etiquetas de material utilizadas no atendimento.
 * Self-contained: GET/POST/DELETE imediatos contra /api/atendimentos/[id]/anexos.
 */
export function AppointmentAttachmentsSection({
  appointmentId,
  canManage,
}: {
  appointmentId: string
  canManage: boolean
}) {
  const [rows, setRows] = useState<AttRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/atendimentos/${appointmentId}/anexos`, { cache: 'no-store' })
      if (res.ok) {
        const b = (await res.json()) as { rows: AttRow[] }
        setRows(b.rows)
      }
    } finally {
      setLoading(false)
    }
  }, [appointmentId])

  useEffect(() => {
    void load()
  }, [load])

  async function onPick(file: File) {
    setError(null)
    if (file.size > MAX_BYTES) {
      setError('A imagem excede 5 MB.')
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/atendimentos/${appointmentId}/anexos`, { method: 'POST', body: fd })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao enviar a foto.')
        return
      }
      await load()
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Remover esta etiqueta?')) return
    setBusy(true)
    try {
      await fetch(`/api/atendimentos/${appointmentId}/anexos/${id}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
          <Tag className="h-3.5 w-3.5" /> Etiquetas de material
        </span>
        {canManage ? (
          <>
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
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
              Adicionar foto
            </Button>
          </>
        ) : null}
      </div>

      {error ? <p className="mb-2 text-[11px] text-destructive">{error}</p> : null}

      {loading ? (
        <p className="py-2 text-[11px] text-slate-500">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-[11px] text-slate-500">Nenhuma etiqueta anexada.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {rows.map((r) => (
            <div key={r.id} className="group relative">
              <a href={r.signedUrl ?? '#'} target="_blank" rel="noreferrer">
                {r.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.signedUrl} alt={r.fileName} className="h-20 w-20 rounded-md border border-slate-200 object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-[10px] text-slate-400">sem prévia</div>
                )}
              </a>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  disabled={busy}
                  aria-label="Remover"
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 text-destructive shadow ring-1 ring-slate-200 hover:bg-destructive hover:text-white"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
