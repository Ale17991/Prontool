'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera, ImageOff, Loader2, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { brDateOnly } from '@/lib/core/patient-portal/format'
import {
  PHOTO_ANGLES,
  PHOTO_ANGLE_LABEL,
  type AngleSeries,
  type PhotoPair,
  type PhotoAngle,
  type ProgressPhoto,
} from '@/lib/core/patients/progress-photos/compare'

interface Props {
  patientId: string
  canWrite: boolean
}

/** Hoje em `YYYY-MM-DD` no fuso de quem está usando — é ele que fotografou. */
function todayYmd(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

export function ProgressPhotosSection({ patientId, canWrite }: Props) {
  const [series, setSeries] = useState<AngleSeries[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const res = await fetch(`/api/pacientes/${patientId}/fotos-evolucao`)
    if (!res.ok) {
      setError('Não foi possível carregar as fotos.')
      setSeries([])
      return
    }
    const body = (await res.json()) as { series: AngleSeries[] }
    setSeries(body.series)
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-100/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Fotos de evolução</h2>
          <p className="text-[11px] text-slate-500">
            O antes e depois é montado sozinho, comparando fotos do mesmo ângulo.
          </p>
        </div>
        {canWrite ? (
          <Button
            size="sm"
            variant={showForm ? 'outline' : 'default'}
            onClick={() => setShowForm((v) => !v)}
            className="gap-1.5"
          >
            {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showForm ? 'Cancelar' : 'Adicionar foto'}
          </Button>
        ) : null}
      </div>

      {showForm && canWrite ? (
        <UploadForm
          patientId={patientId}
          onUploaded={async () => {
            setShowForm(false)
            await load()
          }}
        />
      ) : null}

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      {series === null ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-10 text-sm text-slate-500 shadow-md">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando fotos…
        </div>
      ) : series.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-10 text-center shadow-md">
          <Camera className="mx-auto h-6 w-6 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">Nenhuma foto registrada ainda.</p>
          <p className="text-[11px] text-slate-400">
            A comparação aparece a partir da segunda foto do mesmo ângulo.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {series.map((s) => (
            <AngleBlock
              key={s.angle}
              series={s}
              patientId={patientId}
              canWrite={canWrite}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AngleBlock({
  series,
  patientId,
  canWrite,
  onChanged,
}: {
  series: AngleSeries
  patientId: string
  canWrite: boolean
  onChanged: () => Promise<void>
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-md">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{series.label}</h3>
        <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
          {series.photos.length} {series.photos.length === 1 ? 'foto' : 'fotos'}
        </span>
      </header>

      {series.pairs.length > 0 ? (
        <div className="mt-3 space-y-3">
          {series.pairs.map((pair) => (
            <ComparisonCard key={pair.kind} pair={pair} />
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          Só há uma foto deste ângulo — a comparação aparece quando houver a segunda.
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] font-semibold text-slate-500 hover:text-slate-700">
          Ver todas as fotos deste ângulo
        </summary>
        <ul className="mt-2 flex flex-wrap gap-2">
          {series.photos.map((photo) => (
            <li key={photo.id} className="w-28">
              <Thumb photo={photo} />
              <p className="mt-1 text-center text-[10px] font-semibold text-slate-600">
                {brDateOnly(photo.takenOn)}
              </p>
              {canWrite ? (
                <DeleteButton patientId={patientId} photoId={photo.id} onDeleted={onChanged} />
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}

function ComparisonCard({ pair }: { pair: PhotoPair }) {
  return (
    <figure className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-bold text-slate-900">{pair.label}</span>
        <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
          {pair.interval} de diferença
        </span>
      </figcaption>
      <div className="grid grid-cols-2 gap-2">
        <Side photo={pair.before} caption="Antes" />
        <Side photo={pair.after} caption="Depois" />
      </div>
    </figure>
  )
}

function Side({ photo, caption }: { photo: ProgressPhoto; caption: string }) {
  return (
    <div>
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <Thumb photo={photo} tall />
      </div>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {caption} · {brDateOnly(photo.takenOn)}
      </p>
      {photo.note ? <p className="text-[11px] text-slate-600">{photo.note}</p> : null}
    </div>
  )
}

/**
 * A URL é assinada e pode ter vencido com a aba aberta desde ontem. Quando
 * falha, mostra o quadro de ausência em vez do ícone quebrado do navegador —
 * e diz o que fazer.
 */
function Thumb({ photo, tall = false }: { photo: ProgressPhoto; tall?: boolean }) {
  const [broken, setBroken] = useState(false)
  const box = tall ? 'aspect-[3/4]' : 'aspect-square'

  if (!photo.signedUrl || broken) {
    return (
      <div
        className={`flex ${box} w-full flex-col items-center justify-center gap-1 rounded-md bg-slate-100 text-slate-400`}
      >
        <ImageOff className="h-4 w-4" />
        <span className="px-1 text-center text-[9px] leading-tight">Recarregue a página</span>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.signedUrl}
      alt={`${PHOTO_ANGLE_LABEL[photo.angle]} em ${brDateOnly(photo.takenOn)}`}
      className={`${box} w-full rounded-md object-cover`}
      onError={() => setBroken(true)}
    />
  )
}

function DeleteButton({
  patientId,
  photoId,
  onDeleted,
}: {
  patientId: string
  photoId: string
  onDeleted: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [armed, setArmed] = useState(false)

  async function remove() {
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/fotos-evolucao/${photoId}`, {
        method: 'DELETE',
      })
      if (res.ok) await onDeleted()
    } finally {
      setPending(false)
      setArmed(false)
    }
  }

  // Dois cliques em vez de `confirm()`: o diálogo nativo bloqueia a aba e
  // apagar foto clínica por engano não se desfaz.
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => (armed ? void remove() : setArmed(true))}
      onBlur={() => setArmed(false)}
      className="mt-0.5 flex w-full items-center justify-center gap-1 rounded text-[10px] font-semibold text-slate-400 hover:text-destructive"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
      {armed ? 'Confirmar' : 'Excluir'}
    </button>
  )
}

function UploadForm({
  patientId,
  onUploaded,
}: {
  patientId: string
  onUploaded: () => Promise<void>
}) {
  const [angle, setAngle] = useState<PhotoAngle>('frente')
  const [takenOn, setTakenOn] = useState(todayYmd())
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('Escolha a foto.')
      return
    }
    setPending(true)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('angle', angle)
      form.set('takenOn', takenOn)
      if (note.trim()) form.set('note', note.trim())
      const res = await fetch(`/api/pacientes/${patientId}/fotos-evolucao`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao enviar a foto.')
        return
      }
      setNote('')
      if (fileRef.current) fileRef.current.value = ''
      await onUploaded()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="photo-file">Foto (JPG ou PNG, até 8 MB)</Label>
          <Input id="photo-file" ref={fileRef} type="file" accept="image/jpeg,image/png" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="photo-angle">Ângulo</Label>
          <Select value={angle} onValueChange={(v) => setAngle(v as PhotoAngle)}>
            <SelectTrigger id="photo-angle">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PHOTO_ANGLES.map((a) => (
                <SelectItem key={a} value={a}>
                  {PHOTO_ANGLE_LABEL[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          {/* Editável porque a clínica sobe hoje a foto tirada meses atrás — e é
              esta data, não a do upload, que ordena a série. */}
          <Label htmlFor="photo-date">Data da foto</Label>
          <Input
            id="photo-date"
            type="date"
            value={takenOn}
            max={todayYmd()}
            onChange={(e) => setTakenOn(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="photo-note">Observação (opcional)</Label>
        <Input
          id="photo-note"
          maxLength={300}
          placeholder="Ex.: antes da 1ª sessão"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Camera className="h-3.5 w-3.5" />
          )}
          Enviar foto
        </Button>
      </div>
    </form>
  )
}
