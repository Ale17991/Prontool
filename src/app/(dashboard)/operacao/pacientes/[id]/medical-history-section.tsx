'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Loader2, Plus, Trash2, X } from 'lucide-react'
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
import { formatDate } from '@/lib/utils'
import type { HistoryCategory, PatientHistoryDTO } from '@/lib/core/patient-medical/history'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'
import { VitalHistoryCompactCard } from './_components/vital-history-compact'

const HISTORY_CATEGORY_LABEL: Record<HistoryCategory, string> = {
  doenca_pregressa: 'Doenças pregressas',
  cirurgia: 'Cirurgias',
  medicamento_uso_continuo: 'Medicamentos contínuos',
  antecedente_familiar: 'Antecedentes familiares',
  habito: 'Hábitos',
  outro: 'Outros',
}

interface Props {
  patientId: string
  initialHistory: PatientHistoryDTO[]
  canWrite: boolean
  /** Quando passado, renderiza um card compacto "Sinais vitais (histórico)"
   * abaixo dos antecedentes. Read-only — apenas exibição. */
  initialVitalSigns?: VitalSignsDTO[]
}

export function MedicalHistorySection({
  patientId,
  initialHistory,
  canWrite,
  initialVitalSigns,
}: Props) {
  const router = useRouter()
  const [history, setHistory] = useState(initialHistory)

  async function refreshHistory() {
    const res = await fetch(`/api/pacientes/${patientId}/antecedentes`)
    if (res.ok) setHistory((await res.json()) as PatientHistoryDTO[])
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <HistoryCard
        patientId={patientId}
        history={history}
        canWrite={canWrite}
        onRefresh={refreshHistory}
      />
      {initialVitalSigns !== undefined ? (
        <VitalHistoryCompactCard measurements={initialVitalSigns} />
      ) : null}
    </div>
  )
}

function HistoryCard({
  patientId,
  history,
  canWrite,
  onRefresh,
}: {
  patientId: string
  history: PatientHistoryDTO[]
  canWrite: boolean
  onRefresh: () => Promise<void>
}) {
  const [showForm, setShowForm] = useState(false)
  const grouped = new Map<HistoryCategory, PatientHistoryDTO[]>()
  for (const h of history) {
    const list = grouped.get(h.category) ?? []
    list.push(h)
    grouped.set(h.category, list)
  }

  const ordered: HistoryCategory[] = [
    'doenca_pregressa',
    'cirurgia',
    'medicamento_uso_continuo',
    'antecedente_familiar',
    'habito',
    'outro',
  ]

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 text-primary" />
          Antecedentes
        </CardTitle>
        {canWrite ? (
          <Button
            size="sm"
            variant={showForm ? 'outline' : 'default'}
            onClick={() => setShowForm((v) => !v)}
            className="gap-1.5"
          >
            {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showForm ? 'Cancelar' : 'Adicionar antecedente'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && canWrite ? (
          <NewHistoryForm
            patientId={patientId}
            onCreated={async () => {
              setShowForm(false)
              await onRefresh()
            }}
          />
        ) : null}

        {history.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum antecedente registrado.</p>
        ) : (
          <div className="space-y-4">
            {ordered.map((cat) => {
              const items = grouped.get(cat)
              if (!items || items.length === 0) return null
              return (
                <div key={cat}>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    {HISTORY_CATEGORY_LABEL[cat]}
                  </p>
                  <ul className="space-y-1.5">
                    {items.map((h) => (
                      <HistoryItem
                        key={h.id}
                        patientId={patientId}
                        item={h}
                        canWrite={canWrite}
                        onDeleted={onRefresh}
                      />
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function HistoryItem({
  patientId,
  item,
  canWrite,
  onDeleted,
}: {
  patientId: string
  item: PatientHistoryDTO
  canWrite: boolean
  onDeleted: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!confirm(`Remover antecedente: ${item.description}?`)) return
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/antecedentes/${item.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao remover.')
        return
      }
      await onDeleted()
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{item.description}</p>
        {item.notes ? <p className="mt-0.5 text-[11px] text-slate-600">{item.notes}</p> : null}
        <p className="mt-0.5 text-[10px] text-slate-400">
          {item.dateReported
            ? `Em ${formatDate(item.dateReported)}`
            : `Registrado em ${formatDate(item.createdAt)}`}
        </p>
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      </div>
      {canWrite ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void handleDelete()}
          disabled={pending}
          className="h-7 gap-1 px-2 text-[11px] text-destructive hover:bg-destructive/10"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Remover
        </Button>
      ) : null}
    </li>
  )
}

function NewHistoryForm({
  patientId,
  onCreated,
}: {
  patientId: string
  onCreated: () => Promise<void>
}) {
  const [category, setCategory] = useState<HistoryCategory>('doenca_pregressa')
  const [description, setDescription] = useState('')
  const [dateReported, setDateReported] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (description.trim().length < 1) {
      setError('Informe a descrição.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/antecedentes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category,
          description: description.trim(),
          date_reported: dateReported || null,
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao salvar.')
        return
      }
      setCategory('doenca_pregressa')
      setDescription('')
      setDateReported('')
      setNotes('')
      await onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50/50 p-3 md:grid-cols-2"
    >
      <div className="space-y-1.5">
        <Label>Categoria</Label>
        <Select value={category} onValueChange={(v) => setCategory(v as HistoryCategory)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(HISTORY_CATEGORY_LABEL) as HistoryCategory[]).map((c) => (
              <SelectItem key={c} value={c}>
                {HISTORY_CATEGORY_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="hist_date">Data (opcional)</Label>
        <Input
          id="hist_date"
          type="date"
          value={dateReported}
          onChange={(e) => setDateReported(e.target.value)}
        />
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="hist_desc">Descrição</Label>
        <Input
          id="hist_desc"
          autoFocus
          placeholder="Ex.: Apendicectomia em 2018"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="hist_notes">Observações</Label>
        <Textarea
          id="hist_notes"
          className="min-h-[60px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error ? (
        <p className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      <div className="md:col-span-2 flex justify-end">
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Adicionar
        </Button>
      </div>
    </form>
  )
}
