'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Ban,
  Calendar,
  CheckCheck,
  CheckCircle2,
  Clock,
  Loader2,
  NotebookPen,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatDateTime } from '@/lib/utils'
import type { AppointmentTimelineRow } from '@/lib/core/patient-timeline'
import { formatAuthorDisplay } from '@/lib/core/patient-timeline'
import type { AuthorMap } from '@/lib/core/patient-timeline'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'

interface Props {
  patientId: string
  appointments: AppointmentTimelineRow[]
  initialNotes: ClinicalRecordRow[]
  authors: AuthorMap
  canWriteNote: boolean
}

type EvolutionItem =
  | { kind: 'appointment'; occurredAt: string; data: AppointmentTimelineRow }
  | { kind: 'note'; occurredAt: string; data: ClinicalRecordRow }

export function PatientEvolutionTab({
  patientId,
  appointments,
  initialNotes,
  authors,
  canWriteNote,
}: Props) {
  const router = useRouter()
  const [notes, setNotes] = useState<ClinicalRecordRow[]>(
    initialNotes.filter((r) => r.type === 'texto' && !r.deletedAt),
  )
  const [showForm, setShowForm] = useState(false)

  const items = useMemo<EvolutionItem[]>(() => {
    const merged: EvolutionItem[] = []
    for (const a of appointments) {
      if (!a.appointmentAt) continue
      merged.push({ kind: 'appointment', occurredAt: a.appointmentAt, data: a })
    }
    for (const n of notes) {
      if (n.deletedAt) continue
      merged.push({ kind: 'note', occurredAt: n.createdAt, data: n })
    }
    merged.sort((x, y) => y.occurredAt.localeCompare(x.occurredAt))
    return merged
  }, [appointments, notes])

  async function handleNoteCreated(created: ClinicalRecordRow) {
    setNotes((prev) => [created, ...prev])
    setShowForm(false)
    router.refresh()
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-100/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Evolução do paciente
          </h2>
          <p className="text-[11px] text-slate-500">
            Atendimentos realizados e a realizar + notas simples.
          </p>
        </div>
        {canWriteNote ? (
          <Button
            size="sm"
            variant={showForm ? 'outline' : 'default'}
            onClick={() => setShowForm((v) => !v)}
            className="gap-1.5"
          >
            {showForm ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {showForm ? 'Cancelar' : 'Adicionar nota'}
          </Button>
        ) : null}
      </div>

      {showForm && canWriteNote ? (
        <NewNoteForm
          patientId={patientId}
          onCreated={handleNoteCreated}
        />
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-10 text-center shadow-md">
          <p className="text-sm text-slate-500">
            Nenhum atendimento ou nota registrada ainda.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) =>
            it.kind === 'appointment' ? (
              <AppointmentCard
                key={`appt:${it.data.id}`}
                appointment={it.data}
              />
            ) : (
              <NoteCard
                key={`note:${it.data.id}`}
                note={it.data}
                authorDisplay={formatAuthorDisplay(authors, it.data.createdBy)}
              />
            ),
          )}
        </ul>
      )}
    </div>
  )
}

function statusBadge(status: string | null): {
  label: string
  className: string
  Icon: typeof CheckCircle2
} {
  // 'ativo' e' o unico estado que conta como Realizado — exige
  // appointment_completion (presenca confirmada). 'confirmado' (paciente
  // avisou que vem) e' apenas "A Realizar" — atendimento futuro confirmado.
  if (status === 'ativo' || status === 'realizado') {
    return {
      label: 'Realizado',
      className: 'bg-success-bg text-success-strong',
      Icon: CheckCheck,
    }
  }
  if (status === 'confirmado') {
    return {
      label: 'A Realizar',
      className: 'bg-success-bg/60 text-success-text',
      Icon: CheckCircle2,
    }
  }
  if (status === 'cancelado') {
    return {
      label: 'Cancelado',
      className: 'bg-muted text-muted-foreground',
      Icon: Ban,
    }
  }
  if (status === 'estornado') {
    return {
      label: 'Estornado',
      className: 'bg-[hsl(var(--alert)/0.15)] text-[hsl(var(--alert))]',
      Icon: RotateCcw,
    }
  }
  // Default: 'agendado' (apenas salvo, sem confirmacao do paciente).
  return {
    label: 'Agendado',
    className: 'bg-info-bg text-info-text',
    Icon: Clock,
  }
}

function AppointmentCard({
  appointment,
}: {
  appointment: AppointmentTimelineRow
}) {
  const badge = statusBadge(appointment.effectiveStatus)
  const BadgeIcon = badge.Icon
  return (
    <li>
      <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-md">
        <header className="flex flex-wrap items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Calendar className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-slate-900">
                {appointment.procedureName ?? 'Atendimento'}
              </p>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
                  badge.className,
                )}
              >
                <BadgeIcon className="h-3 w-3" />
                {badge.label}
              </span>
            </div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
              {appointment.appointmentAt
                ? formatDateTime(appointment.appointmentAt)
                : '—'}
            </p>
          </div>
        </header>

        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs md:grid-cols-3">
          <Field label="Procedimento" value={appointment.procedureName ?? '—'} />
          <Field label="Código" value={appointment.tussCode ?? '—'} />
          <Field label="Médico" value={appointment.doctorName ?? '—'} />
        </div>

        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
            Observação
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {appointment.notes?.trim() ? appointment.notes : '—'}
          </p>
        </div>
      </article>
    </li>
  )
}

function NoteCard({
  note,
  authorDisplay,
}: {
  note: ClinicalRecordRow
  authorDisplay: string
}) {
  return (
    <li>
      <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-md">
        <header className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <NotebookPen className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-slate-900">
                {note.title || 'Nota'}
              </p>
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                Nota
              </Badge>
            </div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
              {formatDateTime(note.createdAt)}
              {authorDisplay ? ` · por ${authorDisplay}` : ''}
            </p>
          </div>
        </header>
        {note.content ? (
          <p className="mt-2 whitespace-pre-wrap pl-11 text-sm leading-relaxed text-slate-700">
            {note.content}
          </p>
        ) : null}
      </article>
    </li>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p className="font-semibold text-slate-700">{value}</p>
    </div>
  )
}

function NewNoteForm({
  patientId,
  onCreated,
}: {
  patientId: string
  onCreated: (created: ClinicalRecordRow) => void | Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (content.trim().length < 1) {
      setError('Escreva o conteúdo da nota.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/registros`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'texto',
          title: title.trim() || `Nota — ${new Date().toLocaleDateString('pt-BR')}`,
          content: content.trim(),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao salvar nota.')
        return
      }
      const created = (await res.json()) as ClinicalRecordRow
      setTitle('')
      setContent('')
      await onCreated(created)
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="space-y-1.5">
        <Label htmlFor="note-title">Título (opcional)</Label>
        <Input
          id="note-title"
          placeholder="Ex.: Acompanhamento por telefone"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="note-content">Nota</Label>
        <Textarea
          id="note-content"
          autoFocus
          className="min-h-[100px]"
          placeholder="Escreva uma observação rápida sobre a evolução do paciente…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
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
            <Plus className="h-3.5 w-3.5" />
          )}
          Adicionar nota
        </Button>
      </div>
    </form>
  )
}
