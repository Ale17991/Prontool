'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Plus, Stethoscope, Trash2, X } from 'lucide-react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import type { DiagnosisStatus, PatientDiagnosisDTO } from '@/lib/core/patient-medical/diagnoses'

interface Cid10Item {
  code: string
  description: string
  chapter: string | null
}

interface Props {
  patientId: string
  initialDiagnoses: PatientDiagnosisDTO[]
  canWrite: boolean
  canDelete: boolean
  /** Inicializa o form de novo diagnóstico já aberto (usado quando a section é montada dentro de um Sheet). */
  defaultShowForm?: boolean
  /** Callback disparado após salvamento bem-sucedido — Sheet fecha aqui. */
  onSaved?: () => void
}

const STATUS_LABEL: Record<DiagnosisStatus, string> = {
  ativo: 'Ativo',
  em_acompanhamento: 'Em acompanhamento',
  resolvido: 'Resolvido',
}

// 016 — paleta do designer: ativo usa info-bg/info-text (azul institucional),
// em_acompanhamento usa warning (amber), resolvido usa success-bg/text (verde
// do designer).
const STATUS_CLASS: Record<DiagnosisStatus, string> = {
  ativo: 'bg-info-bg text-info-text',
  em_acompanhamento: 'bg-[hsl(var(--warning)/0.2)] text-[hsl(var(--warning-foreground))]',
  resolvido: 'bg-success-bg text-success-text',
}

export function DiagnosticsSection({
  patientId,
  initialDiagnoses,
  canWrite,
  canDelete,
  defaultShowForm = false,
  onSaved,
}: Props) {
  const router = useRouter()
  const [diagnoses, setDiagnoses] = useState(initialDiagnoses)
  const [showForm, setShowForm] = useState(defaultShowForm)

  useEffect(() => {
    setDiagnoses(initialDiagnoses)
  }, [initialDiagnoses])

  async function refresh() {
    const res = await fetch(`/api/pacientes/${patientId}/diagnosticos`)
    if (res.ok) setDiagnoses((await res.json()) as PatientDiagnosisDTO[])
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Stethoscope className="h-4 w-4 text-primary" />
          Diagnósticos (CID-10)
        </CardTitle>
        {canWrite && !defaultShowForm ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowForm((v) => !v)}
            className="h-8 gap-1.5"
          >
            {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showForm ? 'Cancelar' : 'Adicionar diagnóstico'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        {showForm ? (
          <NewDiagnosisForm
            patientId={patientId}
            onCancel={() => {
              setShowForm(false)
              onSaved?.()
            }}
            onCreated={async () => {
              setShowForm(false)
              await refresh()
              onSaved?.()
            }}
          />
        ) : null}

        {diagnoses.length === 0 ? (
          <p className="px-2 pb-2 text-sm text-slate-500">Nenhum diagnóstico cadastrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Diagnosticado em</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {diagnoses.map((d) => (
                <DiagnosisRow
                  key={d.id}
                  patientId={patientId}
                  diagnosis={d}
                  canWrite={canWrite}
                  canDelete={canDelete}
                  onChanged={refresh}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function DiagnosisRow({
  patientId,
  diagnosis,
  canWrite,
  canDelete,
  onChanged,
}: {
  patientId: string
  diagnosis: PatientDiagnosisDTO
  canWrite: boolean
  canDelete: boolean
  onChanged: () => Promise<void>
}) {
  const [editingStatus, setEditingStatus] = useState(false)
  const [pending, setPending] = useState<'status' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function changeStatus(status: DiagnosisStatus) {
    if (status === diagnosis.status) {
      setEditingStatus(false)
      return
    }
    setError(null)
    setPending('status')
    try {
      const res = await fetch(`/api/pacientes/${patientId}/diagnosticos/${diagnosis.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao atualizar status.')
        return
      }
      setEditingStatus(false)
      await onChanged()
    } finally {
      setPending(null)
    }
  }

  async function handleDelete() {
    if (!confirm(`Remover diagnóstico ${diagnosis.cid10Code}? Pode ser revertido na auditoria.`)) {
      return
    }
    setError(null)
    setPending('delete')
    try {
      const res = await fetch(`/api/pacientes/${patientId}/diagnosticos/${diagnosis.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao remover.')
        return
      }
      await onChanged()
    } finally {
      setPending(null)
    }
  }

  return (
    <TableRow>
      <TableCell>
        <span className="rounded-md bg-blue-100 px-2 py-1 font-mono text-[11px] font-bold text-blue-800">
          {diagnosis.cid10Code}
        </span>
      </TableCell>
      <TableCell className="text-sm text-slate-700">
        <div className="font-medium">{diagnosis.cid10Description}</div>
        {diagnosis.additionalNotes ? (
          <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-slate-500">
            {diagnosis.additionalNotes}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="text-xs text-slate-500">{formatDate(diagnosis.diagnosedAt)}</TableCell>
      <TableCell>
        {editingStatus && canWrite ? (
          <Select
            defaultValue={diagnosis.status}
            onValueChange={(v) => void changeStatus(v as DiagnosisStatus)}
          >
            <SelectTrigger className="h-7 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="em_acompanhamento">Em acompanhamento</SelectItem>
              <SelectItem value="resolvido">Resolvido</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="secondary" className={STATUS_CLASS[diagnosis.status]}>
            {STATUS_LABEL[diagnosis.status]}
          </Badge>
        )}
        {error ? <p className="mt-1 text-[10px] font-semibold text-destructive">{error}</p> : null}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {canWrite && !editingStatus ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditingStatus(true)}
              disabled={pending !== null}
              className="h-7 px-2 text-xs"
            >
              {pending === 'status' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                'Alterar status'
              )}
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleDelete()}
              disabled={pending !== null}
              className="h-7 w-7 p-0 text-slate-400 hover:text-destructive"
              aria-label="Remover diagnóstico"
            >
              {pending === 'delete' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function NewDiagnosisForm({
  patientId,
  onCancel,
  onCreated,
}: {
  patientId: string
  onCancel: () => void
  onCreated: () => Promise<void>
}) {
  const [cidQuery, setCidQuery] = useState('')
  const [cidResults, setCidResults] = useState<Cid10Item[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Cid10Item | null>(null)
  const [notes, setNotes] = useState('')
  const [diagnosedAt, setDiagnosedAt] = useState(new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState<DiagnosisStatus>('ativo')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = cidQuery.trim()
    if (q.length < 2 || selected) {
      setCidResults(null)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cid10?q=${encodeURIComponent(q)}`)
        if (!res.ok) {
          setCidResults([])
          return
        }
        const body = (await res.json()) as { items?: Cid10Item[] }
        setCidResults(body.items ?? [])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [cidQuery, selected])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!selected) {
      setError('Selecione um código CID-10.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/diagnosticos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cid10_code: selected.code,
          cid10_description: selected.description,
          additional_notes: notes.trim() || null,
          diagnosed_at: diagnosedAt,
          status,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao salvar diagnóstico.')
        return
      }
      await onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
    >
      <div>
        <Label className="text-[11px] font-bold uppercase text-slate-500">CID-10</Label>
        {selected ? (
          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
            <span className="rounded bg-blue-100 px-2 py-0.5 font-mono text-[11px] font-bold text-blue-800">
              {selected.code}
            </span>
            <span className="flex-1 text-sm text-slate-700">{selected.description}</span>
            <button
              type="button"
              onClick={() => {
                setSelected(null)
                setCidQuery('')
                setCidResults(null)
              }}
              className="text-slate-400 hover:text-destructive"
              aria-label="Remover seleção"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Input
              placeholder="Buscar por código (ex.: J06) ou descrição (ex.: gripe)…"
              value={cidQuery}
              onChange={(e) => setCidQuery(e.target.value)}
            />
            {cidResults !== null ? (
              <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow">
                {searching ? (
                  <p className="px-3 py-2 text-xs text-slate-500">Buscando…</p>
                ) : cidResults.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-500">Nenhum CID encontrado.</p>
                ) : (
                  cidResults.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => {
                        setSelected(c)
                        setCidResults(null)
                        setCidQuery('')
                      }}
                      className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-blue-50"
                    >
                      <span className="font-mono text-[11px] font-bold text-blue-700">
                        {c.code}
                      </span>
                      <span className="text-xs text-slate-700">{c.description}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div>
        <Label className="text-[11px] font-bold uppercase text-slate-500">
          Descrição adicional (opcional)
        </Label>
        <Textarea
          placeholder="Observações do profissional sobre este diagnóstico…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">
            Data do diagnóstico
          </Label>
          <Input
            type="date"
            value={diagnosedAt}
            onChange={(e) => setDiagnosedAt(e.target.value)}
            required
          />
        </div>
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as DiagnosisStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="em_acompanhamento">Em acompanhamento</SelectItem>
              <SelectItem value="resolvido">Resolvido</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pending} className="gap-1.5">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Salvar
        </Button>
      </div>
    </form>
  )
}
