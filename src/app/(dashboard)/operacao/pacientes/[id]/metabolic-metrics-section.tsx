'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Activity, FlaskConical, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MetricEvolutionChart, formatDateLabel } from '@/components/patient-portal/evolution-chart'
import type { MeasurementDTO } from '@/lib/core/patient-portal/measurements'
import type { PatientMetricType } from '@/lib/core/patient-portal/metric-types'
import { GoalsEditor } from './goals-editor'

/**
 * Feature 030 (US2) — entrada de métricas metabólicas no prontuário.
 *
 * Reusa o padrão de `vital-signs-section.tsx`: form inline + histórico.
 * Append-only: não há editar/excluir — correção é novo registro (FR-012).
 * O servidor valida tipo+faixa e devolve 422 com mensagem clara (FR-013).
 */

interface Props {
  patientId: string
  initialMeasurements: Record<string, MeasurementDTO[]>
  metricTypes: PatientMetricType[]
  canWrite: boolean
}

export function MetabolicMetricsSection({
  patientId,
  initialMeasurements,
  metricTypes,
  canWrite,
}: Props) {
  const [measurements, setMeasurements] = useState(initialMeasurements)
  const [showForm, setShowForm] = useState(false)
  const [showBia, setShowBia] = useState(false)

  // Métricas de bioimpedância (composição corporal) — lançadas em bloco.
  const bioimpedanceMetrics = useMemo(
    () => metricTypes.filter((t) => t.specialty === 'nutricao'),
    [metricTypes],
  )

  async function refresh() {
    const res = await fetch(`/api/pacientes/${patientId}/medicoes`)
    if (res.ok) {
      const body = (await res.json()) as { measurements: Record<string, MeasurementDTO[]> }
      setMeasurements(body.measurements)
    }
  }

  const recent = useMemo(() => {
    const all = Object.values(measurements).flat()
    return all
      .sort((a, b) =>
        a.measuredAt === b.measuredAt
          ? b.createdAt.localeCompare(a.createdAt)
          : b.measuredAt.localeCompare(a.measuredAt),
      )
      .slice(0, 10)
  }, [measurements])

  const labelOf = useMemo(
    () => new Map(metricTypes.map((t) => [t.metricType, t.label])),
    [metricTypes],
  )

  // Mostra o card do gráfico já a partir de 1 medição (o próprio gráfico exibe
  // o valor + aviso de que a linha aparece na 2ª). Antes exigia 2 e a métrica
  // simplesmente sumia, dando a impressão de que o gráfico "não tinha função".
  const chartsWithData = metricTypes.filter((t) => (measurements[t.metricType] ?? []).length >= 1)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FlaskConical className="h-4 w-4 text-primary" />
          Métricas metabólicas
        </CardTitle>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={showForm ? 'outline' : 'default'}
              onClick={() => {
                setShowForm((v) => !v)
                setShowBia(false)
              }}
              className="gap-1.5"
            >
              {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showForm ? 'Cancelar' : 'Nova medição'}
            </Button>
            {bioimpedanceMetrics.length > 0 ? (
              <Button
                size="sm"
                variant={showBia ? 'outline' : 'secondary'}
                onClick={() => {
                  setShowBia((v) => !v)
                  setShowForm(false)
                }}
                className="gap-1.5"
              >
                {showBia ? <X className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
                {showBia ? 'Cancelar' : 'Bioimpedância'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <GoalsEditor patientId={patientId} metricTypes={metricTypes} canWrite={canWrite} />

        {showForm && canWrite ? (
          <NewMeasurementForm
            patientId={patientId}
            metricTypes={metricTypes}
            onCreated={async () => {
              setShowForm(false)
              await refresh()
            }}
          />
        ) : null}

        {showBia && canWrite ? (
          <BioimpedanceForm
            patientId={patientId}
            metrics={bioimpedanceMetrics}
            onCreated={async () => {
              setShowBia(false)
              await refresh()
            }}
          />
        ) : null}

        {recent.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma medição metabólica registrada ainda.</p>
        ) : (
          <>
            {chartsWithData.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {chartsWithData.map((t) => (
                  <MetricEvolutionChart
                    key={t.metricType}
                    label={t.label}
                    unit={t.unit}
                    points={(measurements[t.metricType] ?? []).map((m) => ({
                      date: m.measuredAt,
                      value: m.value,
                    }))}
                  />
                ))}
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Últimos registros
              </p>
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Métrica</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Obs.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-[11px] tabular-nums text-slate-600">
                          {formatDateLabel(m.measuredAt)}/{m.measuredAt.slice(0, 4)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {labelOf.get(m.metricType) ?? m.metricType}
                        </TableCell>
                        <TableCell className="text-xs font-semibold tabular-nums">
                          {m.value} {m.unit}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-slate-500">
                          {m.notes ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Registros são definitivos (trilha clínica) — para corrigir, lance uma nova medição.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function BioimpedanceForm({
  patientId,
  metrics,
  onCreated,
}: {
  patientId: string
  metrics: PatientMetricType[]
  onCreated: () => Promise<void>
}) {
  const todayIso = new Date().toISOString().slice(0, 10)
  const [values, setValues] = useState<Record<string, string>>({})
  const [measuredAt, setMeasuredAt] = useState(todayIso)
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const entries: Array<{ metric_type: string; value: number }> = []
    for (const m of metrics) {
      const raw = (values[m.metricType] ?? '').trim()
      if (raw === '') continue // campo vazio = não medido nesta sessão
      const num = Number(raw.replace(',', '.'))
      if (!Number.isFinite(num)) {
        setError(`Valor inválido em ${m.label}.`)
        return
      }
      entries.push({ metric_type: m.metricType, value: num })
    }
    if (entries.length === 0) {
      setError('Preencha ao menos um campo do exame.')
      return
    }

    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/medicoes/lote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          measured_at: measuredAt,
          notes: notes.trim() || null,
          entries,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao registrar a bioimpedância.')
        return
      }
      setValues({})
      setNotes('')
      await onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50/50 p-3"
    >
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <p className="text-xs font-semibold text-slate-700">Exame de bioimpedância</p>
        <span className="text-[11px] text-slate-400">— preencha só os campos medidos</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="bia_date">Data do exame</Label>
          <Input
            id="bia_date"
            type="date"
            max={todayIso}
            value={measuredAt}
            onChange={(e) => setMeasuredAt(e.target.value)}
          />
        </div>
        {metrics.map((m) => (
          <div key={m.metricType} className="space-y-1.5">
            <Label htmlFor={`bia_${m.metricType}`}>
              {m.label} <span className="text-slate-400">({m.unit})</span>
            </Label>
            <Input
              id={`bia_${m.metricType}`}
              inputMode="decimal"
              placeholder={`${m.minPlausible}–${m.maxPlausible}`}
              value={values[m.metricType] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [m.metricType]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bia_notes">Observações (aparelho, protocolo…)</Label>
        <Input id="bia_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
          Salvar exame
        </Button>
      </div>
    </form>
  )
}

function NewMeasurementForm({
  patientId,
  metricTypes,
  onCreated,
}: {
  patientId: string
  metricTypes: PatientMetricType[]
  onCreated: () => Promise<void>
}) {
  const todayIso = new Date().toISOString().slice(0, 10)
  const [metricType, setMetricType] = useState(metricTypes[0]?.metricType ?? '')
  const [value, setValue] = useState('')
  const [measuredAt, setMeasuredAt] = useState(todayIso)
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = metricTypes.find((t) => t.metricType === metricType)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const num = Number(value.replace(',', '.'))
    if (value.trim() === '' || !Number.isFinite(num)) {
      setError('Informe um valor numérico.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/medicoes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          metric_type: metricType,
          value: num,
          measured_at: measuredAt,
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao registrar.')
        return
      }
      setValue('')
      setNotes('')
      await onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-slate-50/50 p-3 md:grid-cols-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="mm_type">Métrica</Label>
        <select
          id="mm_type"
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          value={metricType}
          onChange={(e) => setMetricType(e.target.value)}
        >
          {metricTypes.map((t) => (
            <option key={t.metricType} value={t.metricType}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mm_value">Valor {selected ? `(${selected.unit})` : ''}</Label>
        <Input
          id="mm_value"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {selected ? (
          <p className="text-[10px] text-slate-400">
            Faixa aceita: {selected.minPlausible}–{selected.maxPlausible} {selected.unit}
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mm_date">Data da medição</Label>
        <Input
          id="mm_date"
          type="date"
          max={todayIso}
          value={measuredAt}
          onChange={(e) => setMeasuredAt(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mm_notes">Observações</Label>
        <Input id="mm_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error ? (
        <p className="col-span-2 md:col-span-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      <div className="col-span-2 md:col-span-4 flex justify-end">
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Salvar
        </Button>
      </div>
    </form>
  )
}
