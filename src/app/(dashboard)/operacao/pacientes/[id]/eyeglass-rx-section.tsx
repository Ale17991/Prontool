'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Glasses, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type EyeField = 'sphere' | 'cylinder' | 'axis' | 'addition' | 'prism' | 'base' | 'dnp'
type Eye = Record<EyeField, string>

const FIELDS: Array<{ key: EyeField; label: string }> = [
  { key: 'sphere', label: 'Esférico' },
  { key: 'cylinder', label: 'Cilíndrico' },
  { key: 'axis', label: 'Eixo' },
  { key: 'addition', label: 'Adição' },
  { key: 'prism', label: 'Prisma' },
  { key: 'base', label: 'Base' },
  { key: 'dnp', label: 'DNP' },
]

const emptyEye = (): Eye => ({ sphere: '', cylinder: '', axis: '', addition: '', prism: '', base: '', dnp: '' })

interface RxRow {
  id: string
  od: Eye
  oe: Eye
  readingDistance: string | null
  createdAt: string
}

export function EyeglassRxSection({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const [rows, setRows] = useState<RxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [od, setOd] = useState<Eye>(emptyEye())
  const [oe, setOe] = useState<Eye>(emptyEye())
  const [readingDistance, setReadingDistance] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pacientes/${patientId}/receitas-oculos`, { cache: 'no-store' })
      if (res.ok) {
        const b = (await res.json()) as { rows: RxRow[] }
        setRows(b.rows)
      }
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  async function emit() {
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/receitas-oculos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ od, oe, reading_distance: readingDistance || null, notes: notes || null }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao emitir.')
        return
      }
      setOd(emptyEye()); setOe(emptyEye()); setReadingDistance(''); setNotes(''); setOpen(false)
      await load()
    } finally {
      setPending(false)
    }
  }

  function eyeInputs(eye: Eye, set: (e: Eye) => void) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {FIELDS.map((f) => (
          <div key={f.key} className="w-16">
            <Label className="block text-[9px] font-bold uppercase text-slate-400">{f.label}</Label>
            <Input
              value={eye[f.key]}
              onChange={(e) => set({ ...eye, [f.key]: e.target.value })}
              className="h-8 px-1.5 text-xs"
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Glasses className="h-4 w-4 text-primary" />
          Receita de óculos
        </CardTitle>
        {canWrite ? (
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> Emitir
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {open && canWrite ? (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/50 p-3">
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">OD — olho direito</p>
              {eyeInputs(od, setOd)}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">OE — olho esquerdo</p>
              {eyeInputs(oe, setOe)}
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="w-48">
                <Label className="text-[11px] font-bold uppercase text-slate-500">Distância de leitura</Label>
                <Input value={readingDistance} onChange={(e) => setReadingDistance(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <Label className="text-[11px] font-bold uppercase text-slate-500">Observações</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
            {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
            <Button type="button" size="sm" onClick={emit} disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Emitir receita
            </Button>
          </div>
        ) : null}

        {loading ? (
          <p className="py-3 text-center text-xs text-slate-500">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-500">Nenhuma receita de óculos.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
                <span className="flex-1 text-slate-700">
                  OD {r.od.sphere || '—'}/{r.od.cylinder || '—'}{r.od.axis ? ` x${r.od.axis}` : ''}
                  {'  ·  '}OE {r.oe.sphere || '—'}/{r.oe.cylinder || '—'}{r.oe.axis ? ` x${r.oe.axis}` : ''}
                </span>
                <span className="whitespace-nowrap text-slate-400">{formatDate(r.createdAt)}</span>
                <a
                  href={`/api/pacientes/${patientId}/receitas-oculos/${r.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-link hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> PDF
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}
