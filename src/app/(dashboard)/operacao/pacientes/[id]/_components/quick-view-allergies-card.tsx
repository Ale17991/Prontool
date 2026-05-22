'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { cn } from '@/lib/utils'
import type {
  AllergySeverity,
  PatientAllergyDTO,
} from '@/lib/core/patient-medical/allergies'

interface Props {
  patientId: string
  initial: PatientAllergyDTO[]
  canWrite: boolean
}

const SEVERITY_CLASSES: Record<AllergySeverity, string> = {
  leve: 'bg-[hsl(var(--warning)/0.2)] text-[hsl(var(--warning-foreground))]',
  moderada: 'bg-orange-100 text-orange-800',
  grave: 'bg-[hsl(var(--alert)/0.15)] text-[hsl(var(--alert))]',
}

const SEVERITY_LABEL: Record<AllergySeverity, string> = {
  leve: 'Leve',
  moderada: 'Moderada',
  grave: 'Grave',
}

export function QuickViewAllergiesCard({ patientId, initial, canWrite }: Props) {
  const router = useRouter()
  const [allergies, setAllergies] = useState<PatientAllergyDTO[]>(initial)
  const [showForm, setShowForm] = useState(false)
  const hasGrave = allergies.some((a) => a.severity === 'grave')

  async function refresh() {
    const res = await fetch(`/api/pacientes/${patientId}/alergias`)
    if (res.ok) setAllergies((await res.json()) as PatientAllergyDTO[])
    router.refresh()
  }

  return (
    <Card
      className={cn(
        hasGrave ? 'border-destructive/40 bg-destructive/5' : '',
      )}
    >
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center gap-1.5">
          <AlertTriangle
            className={cn(
              'h-3.5 w-3.5',
              hasGrave
                ? 'text-destructive'
                : 'text-[hsl(var(--alert))]',
            )}
          />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Alergias ({allergies.length})
          </p>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              aria-label={showForm ? 'Cancelar' : 'Adicionar alergia'}
              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            >
              {showForm ? (
                <X className="h-3 w-3" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
            </button>
          ) : null}
        </div>

        {showForm && canWrite ? (
          <NewAllergyForm
            patientId={patientId}
            onCreated={async () => {
              setShowForm(false)
              await refresh()
            }}
          />
        ) : null}

        {allergies.length === 0 ? (
          <p className="text-[11px] text-slate-500">
            Sem alergias conhecidas.
          </p>
        ) : (
          <ul className="space-y-1">
            {allergies.map((a) => (
              <AllergyChip
                key={a.id}
                patientId={patientId}
                allergy={a}
                canWrite={canWrite}
                onDeleted={refresh}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function AllergyChip({
  patientId,
  allergy,
  canWrite,
  onDeleted,
}: {
  patientId: string
  allergy: PatientAllergyDTO
  canWrite: boolean
  onDeleted: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)

  async function handleDelete() {
    if (!confirm(`Remover alergia: ${allergy.substance}?`)) return
    setPending(true)
    try {
      const res = await fetch(
        `/api/pacientes/${patientId}/alergias/${allergy.id}`,
        { method: 'DELETE' },
      )
      if (res.ok) await onDeleted()
    } finally {
      setPending(false)
    }
  }

  return (
    <li
      className={cn(
        'flex items-center gap-1 rounded-md px-2 py-1 text-[11px]',
        SEVERITY_CLASSES[allergy.severity],
      )}
      role={allergy.severity === 'grave' ? 'status' : undefined}
      title={allergy.notes ?? undefined}
    >
      <span className="truncate font-semibold">{allergy.substance}</span>
      <span className="opacity-70">·</span>
      <span className="capitalize">{SEVERITY_LABEL[allergy.severity]}</span>
      {canWrite ? (
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={pending}
          aria-label={`Remover ${allergy.substance}`}
          className="ml-auto inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-current opacity-60 hover:opacity-100"
        >
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
        </button>
      ) : null}
    </li>
  )
}

function NewAllergyForm({
  patientId,
  onCreated,
}: {
  patientId: string
  onCreated: () => Promise<void>
}) {
  const [substance, setSubstance] = useState('')
  const [severity, setSeverity] = useState<AllergySeverity>('moderada')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (substance.trim().length < 1) {
      setError('Informe a substância.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/alergias`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          substance: substance.trim(),
          severity,
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
      setSubstance('')
      setSeverity('moderada')
      setNotes('')
      await onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-2"
    >
      <div className="space-y-1">
        <Label htmlFor="qv-substance" className="text-[10px]">
          Substância
        </Label>
        <Input
          id="qv-substance"
          autoFocus
          placeholder="Ex.: Dipirona"
          value={substance}
          onChange={(e) => setSubstance(e.target.value)}
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-[10px]">Severidade</Label>
        <Select
          value={severity}
          onValueChange={(v) => setSeverity(v as AllergySeverity)}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="leve">Leve</SelectItem>
            <SelectItem value="moderada">Moderada</SelectItem>
            <SelectItem value="grave">Grave</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="qv-notes" className="text-[10px]">
          Observações
        </Label>
        <Textarea
          id="qv-notes"
          className="min-h-[40px] text-xs"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="sm"
        disabled={pending}
        className="h-7 w-full gap-1.5 text-[11px]"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Plus className="h-3 w-3" />
        )}
        Adicionar
      </Button>
    </form>
  )
}
