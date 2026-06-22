'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Eye, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type AV = { odSc: string; odCc: string; oeSc: string; oeCc: string }
type RefrEye = { sphere: string; cylinder: string; axis: string }
type Refr = { od: RefrEye; oe: RefrEye }
type Pio = { od: string; oe: string }

interface ExamRow {
  id: string
  examDate: string
  av: { odSc: string | null; oeSc: string | null }
  pio: { od: string | null; oe: string | null }
}

const emptyAV = (): AV => ({ odSc: '', odCc: '', oeSc: '', oeCc: '' })
const emptyRefrEye = (): RefrEye => ({ sphere: '', cylinder: '', axis: '' })

export function OphthalExamSection({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const [rows, setRows] = useState<ExamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [av, setAv] = useState<AV>(emptyAV())
  const [refr, setRefr] = useState<Refr>({ od: emptyRefrEye(), oe: emptyRefrEye() })
  const [pio, setPio] = useState<Pio>({ od: '', oe: '' })
  const [biomicroscopy, setBio] = useState('')
  const [fundoscopy, setFundo] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pacientes/${patientId}/exames-oftalmo`, { cache: 'no-store' })
      if (res.ok) {
        const b = (await res.json()) as { rows: ExamRow[] }
        setRows(b.rows)
      }
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  function reset() {
    setAv(emptyAV()); setRefr({ od: emptyRefrEye(), oe: emptyRefrEye() }); setPio({ od: '', oe: '' })
    setBio(''); setFundo(''); setNotes('')
  }

  async function emit() {
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/exames-oftalmo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ av, refr, pio, biomicroscopy: biomicroscopy || null, fundoscopy: fundoscopy || null, notes: notes || null }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao salvar.')
        return
      }
      reset(); setOpen(false); await load()
    } finally {
      setPending(false)
    }
  }

  const cell = 'h-8 w-20 px-1.5 text-xs'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Eye className="h-4 w-4 text-primary" />
          Exame oftalmológico
        </CardTitle>
        {canWrite ? (
          <div className="flex items-center gap-2">
            <a
              href="/configuracoes/modelos-laudo"
              className="text-[11px] font-semibold text-link hover:underline"
            >
              Modelos de laudo
            </a>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen((v) => !v)}>
              <Plus className="h-3.5 w-3.5" /> Novo exame
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {open && canWrite ? (
          <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50/50 p-3">
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">Acuidade visual</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-24 text-xs font-semibold text-slate-600">OD (direito)</span>
                  <LabeledInput label="S/ correção" value={av.odSc} onChange={(v) => setAv({ ...av, odSc: v })} cls={cell} />
                  <LabeledInput label="C/ correção" value={av.odCc} onChange={(v) => setAv({ ...av, odCc: v })} cls={cell} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 text-xs font-semibold text-slate-600">OE (esquerdo)</span>
                  <LabeledInput label="S/ correção" value={av.oeSc} onChange={(v) => setAv({ ...av, oeSc: v })} cls={cell} />
                  <LabeledInput label="C/ correção" value={av.oeCc} onChange={(v) => setAv({ ...av, oeCc: v })} cls={cell} />
                </div>
              </div>
            </div>

            <div>
              <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">Refração</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-24 text-xs font-semibold text-slate-600">OD</span>
                  <LabeledInput label="Esférico" value={refr.od.sphere} onChange={(v) => setRefr({ ...refr, od: { ...refr.od, sphere: v } })} cls={cell} />
                  <LabeledInput label="Cilíndrico" value={refr.od.cylinder} onChange={(v) => setRefr({ ...refr, od: { ...refr.od, cylinder: v } })} cls={cell} />
                  <LabeledInput label="Eixo" value={refr.od.axis} onChange={(v) => setRefr({ ...refr, od: { ...refr.od, axis: v } })} cls={cell} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 text-xs font-semibold text-slate-600">OE</span>
                  <LabeledInput label="Esférico" value={refr.oe.sphere} onChange={(v) => setRefr({ ...refr, oe: { ...refr.oe, sphere: v } })} cls={cell} />
                  <LabeledInput label="Cilíndrico" value={refr.oe.cylinder} onChange={(v) => setRefr({ ...refr, oe: { ...refr.oe, cylinder: v } })} cls={cell} />
                  <LabeledInput label="Eixo" value={refr.oe.axis} onChange={(v) => setRefr({ ...refr, oe: { ...refr.oe, axis: v } })} cls={cell} />
                </div>
              </div>
            </div>

            <div className="flex items-end gap-3">
              <span className="text-[11px] font-bold uppercase text-slate-500">PIO (mmHg)</span>
              <LabeledInput label="OD" value={pio.od} onChange={(v) => setPio({ ...pio, od: v })} cls={cell} />
              <LabeledInput label="OE" value={pio.oe} onChange={(v) => setPio({ ...pio, oe: v })} cls={cell} />
            </div>

            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">Biomicroscopia</Label>
              <Textarea value={biomicroscopy} onChange={(e) => setBio(e.target.value)} rows={2} />
            </div>
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">Fundoscopia / mapeamento de retina</Label>
              <Textarea value={fundoscopy} onChange={(e) => setFundo(e.target.value)} rows={2} />
            </div>
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">Conduta / observações</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
            <Button type="button" size="sm" onClick={emit} disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Salvar exame
            </Button>
          </div>
        ) : null}

        {loading ? (
          <p className="py-3 text-center text-xs text-slate-500">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-500">Nenhum exame registrado.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
                <span className="whitespace-nowrap font-semibold text-slate-700">{formatDate(r.examDate)}</span>
                <span className="flex-1 text-slate-500">
                  AV OD {r.av.odSc || '—'} · OE {r.av.oeSc || '—'} · PIO {r.pio.od || '—'}/{r.pio.oe || '—'}
                </span>
                <a
                  href={`/api/pacientes/${patientId}/exames-oftalmo/${r.id}/pdf`}
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

function LabeledInput({ label, value, onChange, cls }: { label: string; value: string; onChange: (v: string) => void; cls: string }) {
  return (
    <div>
      <Label className="block text-[9px] font-bold uppercase text-slate-400">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
    </div>
  )
}

function formatDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd
}
