'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardCheck,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Upload,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatDateTime, formatFileSize } from '@/lib/utils'
import type {
  AnamnesisFieldSnapshot,
  AnamnesisSnapshot,
  ClinicalRecordRow,
} from '@/lib/core/clinical-records/create'

interface Props {
  patientId: string
  initialRecords: ClinicalRecordRow[]
  canWrite: boolean
}

type Pane = null | 'texto' | 'arquivo'

export function ClinicalRecordsSection({ patientId, initialRecords, canWrite }: Props) {
  const router = useRouter()
  const [records, setRecords] = useState<ClinicalRecordRow[]>(initialRecords)
  const [pane, setPane] = useState<Pane>(null)
  const [isPending, startTransition] = useTransition()

  async function refresh() {
    const res = await fetch(`/api/pacientes/${patientId}/registros`)
    if (res.ok) {
      const body = (await res.json()) as ClinicalRecordRow[]
      setRecords(body)
    }
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-primary" />
          Ficha clínica
        </CardTitle>
        {canWrite ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={pane === 'texto' ? 'default' : 'outline'}
              onClick={() => setPane(pane === 'texto' ? null : 'texto')}
              className="gap-1.5"
            >
              {pane === 'texto' ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              Novo texto
            </Button>
            <Button
              size="sm"
              variant={pane === 'arquivo' ? 'default' : 'outline'}
              onClick={() => setPane(pane === 'arquivo' ? null : 'arquivo')}
              className="gap-1.5"
            >
              {pane === 'arquivo' ? <X className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
              Subir arquivo
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {pane === 'texto' && canWrite ? (
          <NewTextForm
            patientId={patientId}
            onCreated={async () => {
              setPane(null)
              await refresh()
            }}
          />
        ) : null}

        {pane === 'arquivo' && canWrite ? (
          <UploadFileForm
            patientId={patientId}
            onUploaded={async () => {
              setPane(null)
              await refresh()
            }}
          />
        ) : null}

        {records.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Nenhum registro clínico ainda. {canWrite ? 'Adicione o primeiro acima.' : null}
          </p>
        ) : (
          <div className="space-y-3">
            {records.map((r) => (
              <RecordItem key={r.id} record={r} />
            ))}
          </div>
        )}
        {isPending ? (
          <p className="text-[11px] text-slate-400">Atualizando…</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function RecordItem({ record }: { record: ClinicalRecordRow }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <TypeIcon type={record.type} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-slate-900">{record.title}</p>
              <TypeBadge type={record.type} />
            </div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
              {formatDateTime(record.createdAt)} · por {record.createdBy.slice(0, 8)}
            </p>
          </div>
        </div>
        {record.type === 'arquivo' && record.fileSizeBytes ? (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-slate-400">
            {formatFileSize(record.fileSizeBytes)}
          </span>
        ) : null}
      </div>

      {record.type === 'texto' && record.content ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
          {record.content}
        </p>
      ) : null}

      {record.type === 'arquivo' && record.fileName ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Paperclip className="h-3 w-3 text-slate-400" />
          <span className="truncate font-mono">{record.fileName}</span>
        </div>
      ) : null}

      {record.type === 'anamnese' && record.anamnesisData ? (
        <AnamneseView snapshot={record.anamnesisData} />
      ) : null}
    </div>
  )
}

function TypeIcon({ type }: { type: ClinicalRecordRow['type'] }) {
  if (type === 'texto') {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
        <FileText className="h-4 w-4" />
      </div>
    )
  }
  if (type === 'arquivo') {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
        <Paperclip className="h-4 w-4" />
      </div>
    )
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
      <ClipboardCheck className="h-4 w-4" />
    </div>
  )
}

function TypeBadge({ type }: { type: ClinicalRecordRow['type'] }) {
  if (type === 'texto') {
    return <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Texto</Badge>
  }
  if (type === 'arquivo') {
    return <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Arquivo</Badge>
  }
  return (
    <Badge variant="secondary" className="h-5 bg-emerald-100 px-1.5 text-[10px] text-emerald-800">
      Anamnese
    </Badge>
  )
}

function AnamneseView({ snapshot }: { snapshot: AnamnesisSnapshot }) {
  const fields = snapshot.fields ?? []
  const responses = snapshot.responses ?? {}
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
        Modelo: {snapshot.template_title} · v{snapshot.template_version}
      </p>
      {fields.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum campo no snapshot deste modelo.</p>
      ) : (
        <dl className="space-y-2">
          {fields.map((f) => (
            <div key={f.id} className="grid grid-cols-1 gap-0.5 md:grid-cols-[1fr_2fr] md:gap-4">
              <dt className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {f.label}
                {f.required ? <span className="ml-1 text-rose-500">*</span> : null}
              </dt>
              <dd className="text-sm text-slate-700">
                <AnamneseResponse field={f} value={responses[f.id]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function AnamneseResponse({
  field,
  value,
}: {
  field: AnamnesisFieldSnapshot
  value: unknown
}) {
  if (value === undefined || value === null || value === '') {
    return <span className="italic text-slate-400">—</span>
  }
  if (Array.isArray(value)) {
    return <span className="whitespace-pre-wrap">{value.map(String).join(', ')}</span>
  }
  if (typeof value === 'object') {
    return <span className="font-mono text-xs">{JSON.stringify(value)}</span>
  }
  const str = String(value)
  if (field.type === 'texto_longo') {
    return <span className="whitespace-pre-wrap">{str}</span>
  }
  return <span>{str}</span>
}

function NewTextForm({
  patientId,
  onCreated,
}: {
  patientId: string
  onCreated: () => void | Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (title.trim().length < 1) {
      setError('Informe um título.')
      return
    }
    if (content.trim().length < 1) {
      setError('Escreva o conteúdo do registro.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/registros`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao salvar registro.')
        return
      }
      setTitle('')
      setContent('')
      await onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="note_title">Título</Label>
        <Input
          id="note_title"
          autoFocus
          placeholder="Ex.: Evolução 1ª consulta"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="note_content">Descrição</Label>
        <Textarea
          id="note_content"
          className="min-h-[120px]"
          placeholder="Escreva livremente a evolução, queixas, conduta…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Salvar texto
        </Button>
      </div>
    </form>
  )
}

function UploadFileForm({
  patientId,
  onUploaded,
}: {
  patientId: string
  onUploaded: () => void | Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (title.trim().length < 1) {
      setError('Informe um título.')
      return
    }
    if (!file) {
      setError('Selecione um arquivo.')
      return
    }
    setPending(true)
    try {
      const fd = new FormData()
      fd.set('title', title.trim())
      fd.set('file', file)
      const res = await fetch(`/api/pacientes/${patientId}/registros/upload`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao subir arquivo.')
        return
      }
      setTitle('')
      setFile(null)
      await onUploaded()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="file_title">Título</Label>
        <Input
          id="file_title"
          autoFocus
          placeholder="Ex.: Ressonância de joelho D — 12/04"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="file_input">Arquivo</Label>
        <input
          id="file_input"
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className={cn(
            'flex w-full rounded-md border border-input bg-background text-sm shadow-sm',
            'file:mr-3 file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-bold file:uppercase file:tracking-widest file:text-white',
            'file:hover:bg-slate-800',
          )}
        />
        <p className="text-[10px] text-slate-500">
          Até 25 MB. Arquivo é guardado em storage privado; o registro na ficha
          clínica mantém só o nome + tamanho.
        </p>
      </div>
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Subir arquivo
        </Button>
      </div>
    </form>
  )
}
