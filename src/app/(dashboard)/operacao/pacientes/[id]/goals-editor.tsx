'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Target, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PatientMetricType } from '@/lib/core/patient-portal/metric-types'

/**
 * Feature 032/034 — definição de metas pela equipe (Dash de Metas do portal).
 * Autossuficiente: GET/POST/DELETE em /api/pacientes/[id]/metas.
 * Métricas: peso/IMC (vital_signs) + catálogo metabólico.
 */
interface Goal {
  id: string
  metricType: string
  direction: 'decrease' | 'increase'
  targetValue: number
}

const EXTRA_METRICS = [
  { metricType: 'peso_kg', label: 'Peso (kg)' },
  { metricType: 'imc', label: 'IMC' },
]

export function GoalsEditor({
  patientId,
  metricTypes,
  canWrite,
}: {
  patientId: string
  metricTypes: PatientMetricType[]
  canWrite: boolean
}) {
  const base = `/api/pacientes/${patientId}/metas`
  const options = useMemo(
    () => [
      ...EXTRA_METRICS,
      ...metricTypes.map((t) => ({ metricType: t.metricType, label: t.label })),
    ],
    [metricTypes],
  )
  const labelOf = useMemo(() => new Map(options.map((o) => [o.metricType, o.label])), [options])

  const [goals, setGoals] = useState<Goal[]>([])
  const [metricType, setMetricType] = useState(options[0]?.metricType ?? '')
  const [direction, setDirection] = useState<'decrease' | 'increase'>('decrease')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let off = false
    void (async () => {
      const res = await fetch(base).catch(() => null)
      if (res?.ok && !off) setGoals(((await res.json()) as { goals: Goal[] }).goals)
    })()
    return () => {
      off = true
    }
  }, [base])

  function save() {
    const num = Number(target.replace(',', '.'))
    if (!Number.isFinite(num)) {
      setError('Informe um alvo numérico.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metricType, direction, targetValue: num }),
      })
      if (!res.ok) {
        setError('Falha ao salvar a meta.')
        return
      }
      const { id } = (await res.json()) as { id: string }
      setGoals((prev) => [
        ...prev.filter((g) => g.metricType !== metricType),
        { id, metricType, direction, targetValue: num },
      ])
      setTarget('')
    })
  }

  function remove(mt: string) {
    startTransition(async () => {
      const res = await fetch(`${base}?metricType=${encodeURIComponent(mt)}`, { method: 'DELETE' })
      if (res.ok) setGoals((prev) => prev.filter((g) => g.metricType !== mt))
    })
  }

  return (
    <div className="rounded-md border border-sky-100 bg-sky-50/40 p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
        <Target className="h-3.5 w-3.5 text-sky-600" />
        Metas do paciente
      </p>

      {goals.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {goals.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-slate-700">
                {labelOf.get(g.metricType) ?? g.metricType}:{' '}
                <span className="font-semibold">
                  {g.direction === 'decrease' ? 'reduzir até' : 'aumentar até'} {g.targetValue}
                </span>
              </span>
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => remove(g.metricType)}
                  disabled={pending}
                  className="text-slate-400 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-slate-400">Nenhuma meta definida.</p>
      )}

      {canWrite ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="goal_metric" className="text-[11px]">
              Métrica
            </Label>
            <select
              id="goal_metric"
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm"
              value={metricType}
              onChange={(e) => setMetricType(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.metricType} value={o.metricType}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="goal_dir" className="text-[11px]">
              Direção
            </Label>
            <select
              id="goal_dir"
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'decrease' | 'increase')}
            >
              <option value="decrease">Reduzir</option>
              <option value="increase">Aumentar</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="goal_target" className="text-[11px]">
              Alvo
            </Label>
            <Input
              id="goal_target"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              size="sm"
              onClick={save}
              disabled={pending || target.trim() === ''}
              className="w-full gap-1.5"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Definir meta
            </Button>
          </div>
          {error ? (
            <p className="col-span-2 text-xs text-destructive md:col-span-4">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
