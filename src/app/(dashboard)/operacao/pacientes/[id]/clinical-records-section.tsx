'use client'

import { useEffect, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Loader2,
  NotebookPen,
  Paperclip,
  Plus,
  Printer,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn, formatDateTime, formatFileSize } from '@/lib/utils'
import type {
  AnamnesisFieldSnapshot,
  AnamnesisSnapshot,
  ClinicalRecordRow,
  SoapData,
} from '@/lib/core/clinical-records/create'

export interface AnamnesePatientPrefill {
  fullName: string | null
  cpf: string | null
  phone: string | null
  email: string | null
  birthDate: string | null
  healthPlanName: string | null
  address: {
    cep: string | null
    street: string | null
    number: string | null
    complement: string | null
    neighborhood: string | null
    city: string | null
    state: string | null
  }
  allergies: Array<{
    substance: string
    severity: 'leve' | 'moderada' | 'grave'
    notes: string | null
  }>
}

interface Props {
  patientId: string
  patientName?: string | null
  patientPrefill?: AnamnesePatientPrefill
  initialRecords: ClinicalRecordRow[]
  canWrite: boolean
  canApplyAnamnesis: boolean
  canDeleteAnamnese: boolean
}

type Pane = null | 'texto' | 'arquivo' | 'anamnese' | 'evolucao'

export function ClinicalRecordsSection({
  patientId,
  patientName,
  patientPrefill,
  initialRecords,
  canWrite,
  canApplyAnamnesis,
  canDeleteAnamnese,
}: Props) {
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
    <>
      <PrintStyles />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-primary" />
            Ficha clínica
          </CardTitle>
          {canWrite || canApplyAnamnesis ? (
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              {canWrite ? (
                <Button
                  size="sm"
                  variant={pane === 'texto' ? 'default' : 'outline'}
                  onClick={() => setPane(pane === 'texto' ? null : 'texto')}
                  className="gap-1.5"
                >
                  {pane === 'texto' ? (
                    <X className="h-3.5 w-3.5" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Novo texto
                </Button>
              ) : null}
              {canWrite ? (
                <Button
                  size="sm"
                  variant={pane === 'arquivo' ? 'default' : 'outline'}
                  onClick={() => setPane(pane === 'arquivo' ? null : 'arquivo')}
                  className="gap-1.5"
                >
                  {pane === 'arquivo' ? (
                    <X className="h-3.5 w-3.5" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Subir arquivo
                </Button>
              ) : null}
              {canApplyAnamnesis ? (
                <Button
                  size="sm"
                  variant={pane === 'anamnese' ? 'default' : 'outline'}
                  onClick={() => setPane(pane === 'anamnese' ? null : 'anamnese')}
                  className="gap-1.5"
                >
                  {pane === 'anamnese' ? (
                    <X className="h-3.5 w-3.5" />
                  ) : (
                    <ClipboardCheck className="h-3.5 w-3.5" />
                  )}
                  Fazer anamnese
                </Button>
              ) : null}
              {canWrite ? (
                <Button
                  size="sm"
                  variant={pane === 'evolucao' ? 'default' : 'outline'}
                  onClick={() => setPane(pane === 'evolucao' ? null : 'evolucao')}
                  className="gap-1.5"
                >
                  {pane === 'evolucao' ? (
                    <X className="h-3.5 w-3.5" />
                  ) : (
                    <NotebookPen className="h-3.5 w-3.5" />
                  )}
                  Nova evolução
                </Button>
              ) : null}
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

          {pane === 'anamnese' && canApplyAnamnesis ? (
            <NewAnamneseForm
              patientId={patientId}
              patientPrefill={patientPrefill}
              onCreated={async () => {
                setPane(null)
                await refresh()
              }}
            />
          ) : null}

          {pane === 'evolucao' && canWrite ? (
            <NewEvolutionForm
              patientId={patientId}
              onCreated={async () => {
                setPane(null)
                await refresh()
              }}
            />
          ) : null}

          {records.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Nenhum registro clínico ainda.{' '}
              {canWrite || canApplyAnamnesis ? 'Adicione o primeiro acima.' : null}
            </p>
          ) : (
            <div className="space-y-3">
              {records.map((r) => (
                <RecordItem
                  key={r.id}
                  record={r}
                  patientId={patientId}
                  patientName={patientName ?? null}
                  canDeleteAnamnese={canDeleteAnamnese}
                  onDeleted={refresh}
                />
              ))}
            </div>
          )}
          {isPending ? (
            <p className="text-[11px] text-slate-400 print:hidden">Atualizando…</p>
          ) : null}
        </CardContent>
      </Card>
    </>
  )
}

function PrintStyles() {
  // Estilos só aplicados durante window.print(). Quando o body recebe a classe
  // `printing-anamnese`, escondemos tudo da tela exceto o item marcado com
  // data-print-anamnese-target. O atributo é setado pelo handler de print.
  return (
    <style jsx global>{`
      @media print {
        body.printing-anamnese > *:not([data-print-anamnese-target='true']) {
          display: none !important;
        }
        body.printing-anamnese [data-print-anamnese-target='true'] {
          position: fixed !important;
          inset: 0 !important;
          background: white !important;
          padding: 24px !important;
          overflow: visible !important;
          z-index: 9999 !important;
        }
        body.printing-anamnese [data-print-anamnese-target='true'] [data-print-only='show'] {
          display: block !important;
        }
        [data-print-only='show'] {
          display: none;
        }
      }
    `}</style>
  )
}

function RecordItem({
  record,
  patientId,
  patientName,
  canDeleteAnamnese,
  onDeleted,
}: {
  record: ClinicalRecordRow
  patientId: string
  patientName: string | null
  canDeleteAnamnese: boolean
  onDeleted: () => void | Promise<void>
}) {
  const isAnamnese = record.type === 'anamnese' && record.anamnesisData
  const isSoap = record.type === 'evolucao' && record.soapData
  const collapsible = Boolean(isAnamnese || isSoap)
  const [expanded, setExpanded] = useState(!collapsible)
  const [printing, setPrinting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete() {
    if (
      !confirm(
        'Tem certeza? Esta anamnese será removida da ficha do paciente.\n\n' +
          'Para auditoria, a linha continua no banco com soft-delete (deleted_at).',
      )
    ) {
      return
    }
    setDeleteError(null)
    setDeleting(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/registros/${record.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setDeleteError(body.error?.message ?? 'Falha ao remover anamnese.')
        return
      }
      await onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  function handlePrint() {
    setExpanded(true)
    setPrinting(true)
    document.body.classList.add('printing-anamnese')
    const cleanup = () => {
      document.body.classList.remove('printing-anamnese')
      setPrinting(false)
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    // Aguarda 1 frame pra garantir que o DOM aplicou o expand antes de imprimir.
    requestAnimationFrame(() => window.print())
  }

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-print-anamnese-target={printing ? 'true' : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <button
          type="button"
          onClick={collapsible ? () => setExpanded((v) => !v) : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-start gap-3 text-left',
            collapsible ? 'cursor-pointer' : 'cursor-default',
          )}
          aria-expanded={collapsible ? expanded : undefined}
        >
          {collapsible ? (
            <span className="mt-1.5 shrink-0 text-slate-400 print:hidden">
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </span>
          ) : null}
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
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {record.type === 'arquivo' && record.fileSizeBytes ? (
            <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
              {formatFileSize(record.fileSizeBytes)}
            </span>
          ) : null}
          {collapsible ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrint}
              className="h-7 gap-1 px-2 text-[11px] print:hidden"
              title="Exportar PDF (via diálogo de impressão)"
            >
              <Printer className="h-3 w-3" />
              PDF
            </Button>
          ) : null}
          {isAnamnese && canDeleteAnamnese ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="h-7 gap-1 px-2 text-[11px] text-rose-600 hover:text-rose-700 print:hidden"
              title="Remover da ficha (soft-delete; admin only)"
            >
              {deleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Remover
            </Button>
          ) : null}
        </div>
      </div>
      {deleteError ? (
        <p className="mt-2 text-[11px] font-semibold text-rose-700">{deleteError}</p>
      ) : null}

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

      {isAnamnese && record.anamnesisData ? (
        <>
          {/* Cabeçalho extra que só aparece em mídia de impressão */}
          <div data-print-only="show" className="mt-4 border-b border-slate-300 pb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Prontool — anamnese
            </p>
            <p className="mt-1 text-base font-bold text-slate-900">
              Paciente: {patientName ?? '—'}
            </p>
            <p className="text-[11px] text-slate-600">
              Registrada em {formatDateTime(record.createdAt)}
            </p>
          </div>
          {expanded ? <AnamneseView snapshot={record.anamnesisData} /> : null}
        </>
      ) : null}

      {isSoap && record.soapData ? (
        <>
          <div data-print-only="show" className="mt-4 border-b border-slate-300 pb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Prontool — evolução clínica SOAP
            </p>
            <p className="mt-1 text-base font-bold text-slate-900">
              Paciente: {patientName ?? '—'}
            </p>
            <p className="text-[11px] text-slate-600">
              Registrada em {formatDateTime(record.createdAt)}
            </p>
          </div>
          {expanded ? <SoapView soap={record.soapData} /> : null}
        </>
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
  if (type === 'evolucao') {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
        <NotebookPen className="h-4 w-4" />
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
    return (
      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
        Texto
      </Badge>
    )
  }
  if (type === 'arquivo') {
    return (
      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
        Arquivo
      </Badge>
    )
  }
  if (type === 'evolucao') {
    return (
      <Badge variant="secondary" className="h-5 bg-blue-100 px-1.5 text-[10px] text-blue-800">
        Evolução SOAP
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="h-5 bg-emerald-100 px-1.5 text-[10px] text-emerald-800">
      Anamnese
    </Badge>
  )
}

function SoapView({ soap }: { soap: SoapData }) {
  const sections: Array<{ key: keyof SoapData; label: string; letter: string }> = [
    { key: 'subjective', label: 'Subjetivo', letter: 'S' },
    { key: 'objective', label: 'Objetivo', letter: 'O' },
    { key: 'assessment', label: 'Avaliação', letter: 'A' },
    { key: 'plan', label: 'Plano', letter: 'P' },
  ]
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-blue-50/40 p-3 print:bg-white print:p-0">
      {sections.map((s) => {
        const value = soap[s.key]
        if (typeof value !== 'string' || !value.trim()) return null
        return (
          <div key={s.letter}>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded bg-blue-600 text-[9px] text-white">
                {s.letter}
              </span>
              {s.label}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{value}</p>
          </div>
        )
      })}
      {soap.assessment_cids && soap.assessment_cids.length > 0 ? (
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">
            CIDs vinculados
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {soap.assessment_cids.map((c) => (
              <span
                key={c.code}
                className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-1 text-[11px] text-blue-800"
              >
                <span className="font-mono font-bold">{c.code}</span>
                <span>{c.description}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AnamneseView({ snapshot }: { snapshot: AnamnesisSnapshot }) {
  // Campos is_default (nome, CPF, telefone, plano, alergias etc.) são
  // dados do paciente que já aparecem no header e nas seções da ficha
  // (Alergias, Endereço, Plano). Repetir aqui é redundante. Snapshot
  // continua íntegro em anamnesisData — filtro é só na exibição.
  const fields = (snapshot.fields ?? []).filter((f) => !f.is_default)
  const responses = snapshot.responses ?? {}
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3 print:bg-white print:p-0">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
        Modelo: {snapshot.template_title} · v{snapshot.template_version}
      </p>
      {fields.length === 0 ? (
        <p className="text-xs text-slate-500">
          Esta anamnese só tem campos padrão (nome, CPF, plano, etc.) — os
          dados aparecem no header e nas seções da ficha.
        </p>
      ) : (
        <dl className="space-y-2">
          {fields.map((f) => (
            <div
              key={f.id}
              className="grid grid-cols-1 gap-0.5 md:grid-cols-[1fr_2fr] md:gap-4"
            >
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

// ---------------------------------------------------------------------------
// New text + file forms (inalterados)
// ---------------------------------------------------------------------------

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
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
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
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          Subir arquivo
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// New anamnese form
// ---------------------------------------------------------------------------

type FieldType =
  | 'texto_curto'
  | 'texto_longo'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'data'
  | 'numero'

interface TemplateRow {
  id: string
  title: string
  description: string | null
  version: number
  fields: AnamnesisFieldSnapshot[] | null
}

type ResponseValue = string | number | string[] | null

function buildPrefillFromPatient(
  fields: AnamnesisFieldSnapshot[],
  prefill: AnamnesePatientPrefill | undefined,
): Record<string, ResponseValue> {
  if (!prefill) return {}
  const formatAddress = (a: AnamnesePatientPrefill['address']): string | null => {
    const line1 = [a.street, a.number].filter(Boolean).join(', ')
    const compl = a.complement ? ` — ${a.complement}` : ''
    const line2 = [a.neighborhood, a.city, a.state].filter(Boolean).join(' · ')
    const full = [line1 + compl, line2].filter(Boolean).join('\n')
    return full || null
  }
  const formatCep = (raw: string | null | undefined): string | null => {
    if (!raw) return null
    const d = raw.replace(/\D/g, '')
    return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : raw
  }
  const formatAllergies = (
    list: AnamnesePatientPrefill['allergies'],
  ): string | null => {
    if (!list || list.length === 0) return null
    return list
      .map((a) => {
        const head = `${a.substance} (${a.severity})`
        return a.notes ? `${head} — ${a.notes}` : head
      })
      .join('\n')
  }
  const map: Record<string, ResponseValue> = {
    default_nome: prefill.fullName ?? null,
    default_cpf: prefill.cpf ?? null,
    default_telefone: prefill.phone ?? null,
    default_email: prefill.email ?? null,
    default_data_nasc: prefill.birthDate ?? null,
    default_plano: prefill.healthPlanName ?? null,
    default_cep: formatCep(prefill.address.cep),
    default_endereco: formatAddress(prefill.address),
    default_alergias: formatAllergies(prefill.allergies),
  }
  const out: Record<string, ResponseValue> = {}
  for (const f of fields) {
    if (!f.is_default) continue
    const v = map[f.id]
    if (v !== undefined && v !== null && v !== '') out[f.id] = v
  }
  return out
}

// ---------------------------------------------------------------------------
// New evolution (SOAP) form
// ---------------------------------------------------------------------------

interface CidOption {
  code: string
  description: string
}

function NewEvolutionForm({
  patientId,
  onCreated,
}: {
  patientId: string
  onCreated: () => void | Promise<void>
}) {
  const [subjective, setSubjective] = useState('')
  const [objective, setObjective] = useState('')
  const [assessment, setAssessment] = useState('')
  const [plan, setPlan] = useState('')
  const [cidQuery, setCidQuery] = useState('')
  const [cidResults, setCidResults] = useState<CidOption[] | null>(null)
  const [cidSelected, setCidSelected] = useState<CidOption[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Busca CID-10 com debounce.
  useEffect(() => {
    const q = cidQuery.trim()
    if (q.length < 2) {
      setCidResults(null)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cid10?q=${encodeURIComponent(q)}`)
        if (!res.ok) {
          if (!cancelled) setCidResults([])
          return
        }
        const body = (await res.json()) as { items: CidOption[] }
        if (!cancelled) setCidResults(body.items ?? [])
      } catch {
        if (!cancelled) setCidResults([])
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [cidQuery])

  function addCid(opt: CidOption) {
    if (cidSelected.some((c) => c.code === opt.code)) return
    setCidSelected((prev) => [...prev, opt])
    setCidQuery('')
    setCidResults(null)
  }

  function removeCid(code: string) {
    setCidSelected((prev) => prev.filter((c) => c.code !== code))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (subjective.trim().length < 1) {
      setError('Preencha o campo Subjetivo (S).')
      return
    }
    if (assessment.trim().length < 1) {
      setError('Preencha o campo Avaliação (A).')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/registros`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'evolucao',
          soap_data: {
            subjective: subjective.trim(),
            objective: objective.trim() || null,
            assessment: assessment.trim(),
            plan: plan.trim() || null,
            assessment_cids: cidSelected,
          },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao salvar evolução.')
        return
      }

      // Sugere registrar os CIDs como diagnósticos formais. Best-effort
      // — falha silenciosa por CID não bloqueia o fluxo da evolução.
      if (cidSelected.length > 0) {
        const msg =
          cidSelected.length === 1
            ? `Adicionar ${cidSelected[0]!.code} aos diagnósticos do paciente?`
            : `Adicionar os ${cidSelected.length} CIDs selecionados aos diagnósticos do paciente?`
        if (confirm(msg)) {
          await Promise.all(
            cidSelected.map((c) =>
              fetch(`/api/pacientes/${patientId}/diagnosticos`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  cid10_code: c.code,
                  cid10_description: c.description,
                  status: 'ativo',
                }),
              }).catch(() => undefined),
            ),
          )
        }
      }

      setSubjective('')
      setObjective('')
      setAssessment('')
      setPlan('')
      setCidSelected([])
      await onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="soap_s">
          <span className="font-bold text-blue-700">S</span> — Subjetivo{' '}
          <span className="text-rose-500">*</span>
        </Label>
        <Textarea
          id="soap_s"
          autoFocus
          className="min-h-[80px]"
          placeholder="Queixa do paciente, história da doença atual…"
          value={subjective}
          onChange={(e) => setSubjective(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="soap_o">
          <span className="font-bold text-blue-700">O</span> — Objetivo
        </Label>
        <Textarea
          id="soap_o"
          className="min-h-[80px]"
          placeholder="Exame físico, sinais vitais, resultados de exames…"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="soap_a">
          <span className="font-bold text-blue-700">A</span> — Avaliação{' '}
          <span className="text-rose-500">*</span>
        </Label>
        <Textarea
          id="soap_a"
          className="min-h-[80px]"
          placeholder="Hipótese diagnóstica, raciocínio clínico…"
          value={assessment}
          onChange={(e) => setAssessment(e.target.value)}
        />
        <div className="space-y-1.5">
          <Label htmlFor="soap_cid" className="text-[11px]">
            Vincular CID-10
          </Label>
          <Input
            id="soap_cid"
            placeholder="Buscar por código (ex.: J06) ou descrição (ex.: gripe)…"
            value={cidQuery}
            onChange={(e) => setCidQuery(e.target.value)}
          />
          {cidResults !== null ? (
            <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white text-xs">
              {cidResults.length === 0 ? (
                <p className="px-3 py-2 text-slate-400">
                  Nenhum resultado. Tente outro termo.
                </p>
              ) : (
                cidResults.map((c) => (
                  <button
                    type="button"
                    key={c.code}
                    onClick={() => addCid(c)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-blue-50"
                  >
                    <span className="font-mono font-bold text-blue-700">
                      {c.code}
                    </span>
                    <span className="text-slate-700">{c.description}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
          {cidSelected.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {cidSelected.map((c) => (
                <span
                  key={c.code}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-1 text-[11px] text-blue-800"
                >
                  <span className="font-mono font-bold">{c.code}</span>
                  <span className="max-w-[200px] truncate">{c.description}</span>
                  <button
                    type="button"
                    onClick={() => removeCid(c.code)}
                    className="ml-1 text-blue-500 hover:text-blue-700"
                    aria-label={`Remover ${c.code}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="soap_p">
          <span className="font-bold text-blue-700">P</span> — Plano
        </Label>
        <Textarea
          id="soap_p"
          className="min-h-[80px]"
          placeholder="Conduta terapêutica, prescrições, retorno…"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
        />
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <NotebookPen className="h-3.5 w-3.5" />
          )}
          Salvar evolução
        </Button>
      </div>
    </form>
  )
}

function NewAnamneseForm({
  patientId,
  patientPrefill,
  onCreated,
}: {
  patientId: string
  patientPrefill?: AnamnesePatientPrefill
  onCreated: () => void | Promise<void>
}) {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState<string>('')
  const [responses, setResponses] = useState<Record<string, ResponseValue>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/anamnesis-templates')
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string }
          }
          throw new Error(body.error?.message ?? `HTTP ${res.status}`)
        }
        const raw = (await res.json()) as TemplateRow[]
        // Backend já ordena title asc, version desc — pegamos o primeiro de
        // cada title (= versão mais recente) e só consideramos com fields.
        const seen = new Set<string>()
        const latest = raw.filter((t) => {
          if (seen.has(t.title)) return false
          if (!Array.isArray(t.fields) || t.fields.length === 0) return false
          seen.add(t.title)
          return true
        })
        if (!cancelled) setTemplates(latest)
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Falha ao carregar modelos.')
          setTemplates([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selected = templates?.find((t) => t.id === templateId) ?? null
  const fields = selected?.fields ?? []

  // Quando troca o template, refaz pré-fill com defaults do paciente.
  useEffect(() => {
    if (!selected) {
      setResponses({})
      return
    }
    setResponses(buildPrefillFromPatient(selected.fields ?? [], patientPrefill))
  }, [selected, patientPrefill])

  function setValue(fieldId: string, value: ResponseValue) {
    setResponses((prev) => ({ ...prev, [fieldId]: value }))
  }

  function toggleCheckbox(fieldId: string, option: string, checked: boolean) {
    const current = (responses[fieldId] as string[] | undefined) ?? []
    const next = checked ? [...current, option] : current.filter((o) => o !== option)
    setValue(fieldId, next)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!selected) {
      setError('Selecione um modelo.')
      return
    }
    for (const f of fields) {
      if (!f.required) continue
      const v = responses[f.id]
      const empty =
        v === undefined ||
        v === null ||
        v === '' ||
        (Array.isArray(v) && v.length === 0)
      if (empty) {
        setError(`Preencha o campo obrigatório: ${f.label}`)
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/anamnesis-templates/${selected.id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, responses }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao salvar a anamnese.')
        return
      }
      setTemplateId('')
      setResponses({})
      await onCreated()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4"
    >
      <div className="space-y-1.5">
        <Label>Modelo de anamnese</Label>
        {templates === null ? (
          <p className="text-xs text-slate-500">Carregando modelos…</p>
        ) : templates.length === 0 ? (
          <p className="text-xs text-slate-500">
            Nenhum modelo cadastrado.{' '}
            <a
              href="/cadastros/anamnese/novo"
              className="font-semibold text-primary underline"
              target="_blank"
              rel="noreferrer"
            >
              Criar primeiro modelo
            </a>
            .
          </p>
        ) : (
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um modelo…" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                  <span className="ml-2 text-[10px] text-slate-400">v{t.version}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {loadError ? (
          <p className="text-[11px] text-rose-600">{loadError}</p>
        ) : null}
      </div>

      {selected ? (
        <div className="space-y-4 border-t border-slate-200 pt-4">
          {fields.map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              value={responses[field.id]}
              onChange={(v) => setValue(field.id, v)}
              onToggleOption={(opt, checked) => toggleCheckbox(field.id, opt, checked)}
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={submitting || !selected} className="gap-2">
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ClipboardCheck className="h-3.5 w-3.5" />
          )}
          Salvar anamnese
        </Button>
      </div>
    </form>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  onToggleOption,
}: {
  field: AnamnesisFieldSnapshot
  value: ResponseValue | undefined
  onChange: (v: ResponseValue) => void
  onToggleOption: (option: string, checked: boolean) => void
}) {
  const type = field.type as FieldType
  const label = (
    <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
      <span>
        {field.label}
        {field.required ? <span className="ml-1 text-rose-500">*</span> : null}
      </span>
      {field.is_default ? (
        <Badge
          variant="secondary"
          className="h-4 bg-blue-100 px-1.5 text-[9px] text-blue-800"
        >
          Padrão
        </Badge>
      ) : null}
    </label>
  )

  if (type === 'texto_longo') {
    return (
      <div className="space-y-1.5">
        {label}
        <Textarea
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[96px]"
        />
      </div>
    )
  }

  if (type === 'data') {
    return (
      <div className="space-y-1.5">
        {label}
        <Input
          type="date"
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (type === 'numero') {
    return (
      <div className="space-y-1.5">
        {label}
        <Input
          type="number"
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (type === 'select') {
    const opts = field.options ?? []
    return (
      <div className="space-y-1.5">
        {label}
        <Select
          value={(value as string | undefined) ?? ''}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>
            {opts.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (type === 'radio') {
    const opts = field.options ?? []
    return (
      <div className="space-y-2">
        {label}
        <div className="flex flex-col gap-2">
          {opts.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name={field.id}
                value={opt}
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="h-4 w-4"
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    )
  }

  if (type === 'checkbox') {
    const opts = field.options ?? []
    const checked = (value as string[] | undefined) ?? []
    return (
      <div className="space-y-2">
        {label}
        <div className="flex flex-col gap-2">
          {opts.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={checked.includes(opt)}
                onChange={(e) => onToggleOption(opt, e.target.checked)}
                className="h-4 w-4"
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {label}
      <Input
        value={(value as string | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
