'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Save, Search, Stamp, Trash2, UtensilsCrossed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PatientTypeahead, type PatientTypeaheadValue } from '@/components/patients/patient-typeahead'
import {
  itemNutrients,
  roundNutrients,
  targetDelta,
  type Nutrients,
} from '@/lib/core/nutrition/diet/totals'
import type { FoodDTO } from '@/lib/core/nutrition/foods/search'

// ---- estado local do cardápio (edição) ---------------------------------
interface EditItem {
  key: string
  foodId: string
  name: string
  referenceGrams: number
  energyKcal: number
  proteinG: number
  carbG: number
  fatG: number
  fiberG: number | null
  grams: number
}
interface EditMeal {
  key: string
  name: string
  timeLabel: string
  items: EditItem[]
}
interface PlanMeta {
  id: string | null
  status: 'rascunho' | 'prescrito'
  target: { kcal: number; macros: { protG: number; carbG: number; fatG: number } | null; assessmentId: string | null } | null
}

let seq = 0
const nextKey = () => `k${++seq}`

function toNutrients(it: EditItem): Nutrients {
  return roundNutrients(
    itemNutrients({
      grams: it.grams,
      food: {
        referenceGrams: it.referenceGrams,
        energyKcal: it.energyKcal,
        proteinG: it.proteinG,
        carbG: it.carbG,
        fatG: it.fatG,
        fiberG: it.fiberG,
      },
    }),
  )
}
function sum(list: Nutrients[]): Nutrients {
  return roundNutrients(
    list.reduce(
      (a, b) => ({
        energyKcal: a.energyKcal + b.energyKcal,
        proteinG: a.proteinG + b.proteinG,
        carbG: a.carbG + b.carbG,
        fatG: a.fatG + b.fatG,
        fiberG: a.fiberG + b.fiberG,
      }),
      { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 },
    ),
  )
}

export function PlanBuilderClient() {
  const [patient, setPatient] = useState<PatientTypeaheadValue | null>(null)
  const [title, setTitle] = useState('Plano alimentar')
  const [meals, setMeals] = useState<EditMeal[]>([])
  const [meta, setMeta] = useState<PlanMeta>({ id: null, status: 'rascunho', target: null })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [prescribing, setPrescribing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async (patientId: string) => {
    setLoading(true)
    setMsg(null)
    const res = await fetch(`/api/pacientes/${patientId}/plano-alimentar`)
    if (res.ok) {
      const { plan } = (await res.json()) as { plan: PlanApiView | null }
      if (plan) {
        setTitle(plan.title)
        setMeta({ id: plan.id, status: plan.status, target: plan.target })
        setMeals(
          plan.meals.map((m) => ({
            key: nextKey(),
            name: m.name,
            timeLabel: m.timeLabel ?? '',
            items: m.items
              .filter((i) => i.foodId && i.grams !== null)
              .map((i) => ({
                key: nextKey(),
                foodId: i.foodId!,
                name: i.name,
                referenceGrams: 100,
                energyKcal: i.nutrients?.energyKcal ?? 0,
                proteinG: i.nutrients?.proteinG ?? 0,
                carbG: i.nutrients?.carbG ?? 0,
                fatG: i.nutrients?.fatG ?? 0,
                fiberG: i.nutrients?.fiberG ?? null,
                grams: i.grams!,
                // NB: os nutrientes vêm já escalados; reconstruímos a base a partir da porção.
              }))
              // Reescala a base para 100 g equivalente (a UI recomputa por grama).
              .map((i) => rescaleToBase(i)),
          })),
        )
      } else {
        setTitle('Plano alimentar')
        setMeta({ id: null, status: 'rascunho', target: null })
        setMeals([])
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (patient) void load(patient.id)
    else {
      setMeals([])
      setMeta({ id: null, status: 'rascunho', target: null })
    }
  }, [patient, load])

  const dayTotal = useMemo(
    () => sum(meals.flatMap((m) => m.items.map(toNutrients))),
    [meals],
  )
  const delta = useMemo(
    () => targetDelta(dayTotal, meta.target ? { kcal: meta.target.kcal, macros: meta.target.macros } : null),
    [dayTotal, meta.target],
  )

  function addMeal() {
    setMeals((v) => [...v, { key: nextKey(), name: 'Refeição', timeLabel: '', items: [] }])
  }
  function removeMeal(key: string) {
    setMeals((v) => v.filter((m) => m.key !== key))
  }
  function addItem(mealKey: string, food: FoodDTO) {
    const defaultGrams = food.measures.find((m) => m.isDefault)?.grams ?? food.referenceGrams
    setMeals((v) =>
      v.map((m) =>
        m.key === mealKey
          ? {
              ...m,
              items: [
                ...m.items,
                {
                  key: nextKey(),
                  foodId: food.id,
                  name: food.name,
                  referenceGrams: food.referenceGrams,
                  energyKcal: food.energyKcal,
                  proteinG: food.proteinG,
                  carbG: food.carbG,
                  fatG: food.fatG,
                  fiberG: food.fiberG,
                  grams: defaultGrams,
                },
              ],
            }
          : m,
      ),
    )
  }
  function setItemGrams(mealKey: string, itemKey: string, grams: number) {
    setMeals((v) =>
      v.map((m) =>
        m.key === mealKey
          ? { ...m, items: m.items.map((i) => (i.key === itemKey ? { ...i, grams } : i)) }
          : m,
      ),
    )
  }
  function removeItem(mealKey: string, itemKey: string) {
    setMeals((v) =>
      v.map((m) => (m.key === mealKey ? { ...m, items: m.items.filter((i) => i.key !== itemKey) } : m)),
    )
  }

  async function save(): Promise<string | null> {
    if (!patient) return null
    setSaving(true)
    setMsg(null)
    try {
      const body = {
        title,
        assessment_id: meta.target?.assessmentId ?? null,
        meals: meals.map((m, mi) => ({
          name: m.name,
          time_label: m.timeLabel || null,
          position: mi,
          items: m.items.map((i) => ({ food_id: i.foodId, grams: i.grams })),
        })),
      }
      const res = await fetch(`/api/pacientes/${patient.id}/plano-alimentar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setMsg('Falha ao salvar o plano.')
        return null
      }
      const { id, plan } = (await res.json()) as { id: string; plan: PlanApiView | null }
      if (plan) setMeta({ id: plan.id, status: plan.status, target: plan.target })
      setMsg('Rascunho salvo.')
      return id
    } finally {
      setSaving(false)
    }
  }

  async function prescribe() {
    if (!patient) return
    const planId = await save()
    if (!planId) return
    setPrescribing(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/pacientes/${patient.id}/plano-alimentar/prescrever`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setMsg(b.error?.message ?? 'Falha ao prescrever.')
        return
      }
      setMsg('Plano prescrito e disponível no portal do paciente.')
      await load(patient.id)
    } finally {
      setPrescribing(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardContent className="grid gap-3 pt-6 md:grid-cols-2">
            <div>
              <Label>Paciente</Label>
              <PatientTypeahead value={patient?.id ?? null} onChange={setPatient} />
            </div>
            <div>
              <Label htmlFor="pa_title">Título do plano</Label>
              <Input id="pa_title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <p className="text-sm text-slate-400">
            <Loader2 className="inline h-4 w-4 animate-spin" /> Carregando…
          </p>
        ) : !patient ? (
          <p className="text-sm text-slate-400">Selecione um paciente para montar o plano.</p>
        ) : (
          <>
            {meta.status === 'prescrito' ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                Este plano está <strong>prescrito</strong>. Edite e salve para criar uma nova versão.
              </p>
            ) : null}
            {meals.map((meal) => (
              <MealCard
                key={meal.key}
                meal={meal}
                onName={(name) => setMeals((v) => v.map((m) => (m.key === meal.key ? { ...m, name } : m)))}
                onTime={(t) => setMeals((v) => v.map((m) => (m.key === meal.key ? { ...m, timeLabel: t } : m)))}
                onAddItem={(f) => addItem(meal.key, f)}
                onGrams={(ik, g) => setItemGrams(meal.key, ik, g)}
                onRemoveItem={(ik) => removeItem(meal.key, ik)}
                onRemove={() => removeMeal(meal.key)}
              />
            ))}
            <Button variant="outline" size="sm" onClick={addMeal} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Adicionar refeição
            </Button>
          </>
        )}
      </div>

      <div className="space-y-4">
        <TotalsPanel dayTotal={dayTotal} target={meta.target} delta={delta} />
        {patient ? (
          <div className="space-y-2">
            {msg ? <p className="text-xs text-slate-500">{msg}</p> : null}
            <div className="flex gap-2">
              <Button variant="outline" onClick={save} disabled={saving} className="flex-1 gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
              </Button>
              <Button
                onClick={prescribe}
                disabled={prescribing || meals.every((m) => m.items.length === 0)}
                className="flex-1 gap-1.5"
              >
                {prescribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stamp className="h-4 w-4" />} Prescrever
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function MealCard({
  meal,
  onName,
  onTime,
  onAddItem,
  onGrams,
  onRemoveItem,
  onRemove,
}: {
  meal: EditMeal
  onName: (v: string) => void
  onTime: (v: string) => void
  onAddItem: (f: FoodDTO) => void
  onGrams: (itemKey: string, grams: number) => void
  onRemoveItem: (itemKey: string) => void
  onRemove: () => void
}) {
  const total = sum(meal.items.map(toNutrients))
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <UtensilsCrossed className="h-4 w-4 text-primary" />
        <Input
          className="h-8 max-w-[180px] font-semibold"
          value={meal.name}
          onChange={(e) => onName(e.target.value)}
        />
        <Input
          className="h-8 max-w-[90px] text-xs"
          placeholder="07:00"
          value={meal.timeLabel}
          onChange={(e) => onTime(e.target.value)}
        />
        <span className="ml-auto text-xs font-semibold tabular-nums text-slate-600">
          {total.energyKcal} kcal
        </span>
        <button type="button" onClick={onRemove} className="text-slate-400 hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="space-y-2">
        {meal.items.map((it) => {
          const n = toNutrients(it)
          return (
            <div key={it.key} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{it.name}</span>
              <Input
                className="h-8 w-20 text-right"
                inputMode="decimal"
                value={String(it.grams)}
                onChange={(e) => onGrams(it.key, Number(e.target.value.replace(',', '.')) || 0)}
              />
              <span className="text-xs text-slate-400">g</span>
              <span className="w-16 text-right text-xs tabular-nums text-slate-500">{n.energyKcal} kcal</span>
              <button
                type="button"
                onClick={() => onRemoveItem(it.key)}
                className="text-slate-300 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
        <FoodSearch onPick={onAddItem} />
      </CardContent>
    </Card>
  )
}

function FoodSearch({ onPick }: { onPick: (f: FoodDTO) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<FoodDTO[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/alimentos?q=${encodeURIComponent(q.trim())}&limit=8`)
      if (res.ok) setResults(((await res.json()) as { foods: FoodDTO[] }).foods)
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
        <Input
          className="h-8 pl-8 text-sm"
          placeholder="Adicionar alimento…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && results.length > 0 ? (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                onPick(f)
                setQ('')
                setResults([])
                setOpen(false)
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50"
            >
              <span className="truncate">{f.name}</span>
              <span className="ml-2 shrink-0 text-[10px] text-slate-400">
                {f.energyKcal} kcal/{f.referenceGrams}g
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TotalsPanel({
  dayTotal,
  target,
  delta,
}: {
  dayTotal: Nutrients
  target: PlanMeta['target']
  delta: ReturnType<typeof targetDelta>
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Totais do dia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <Row label="Energia" value={`${dayTotal.energyKcal} kcal`} />
        <Row label="Proteína" value={`${dayTotal.proteinG} g`} />
        <Row label="Carboidrato" value={`${dayTotal.carbG} g`} />
        <Row label="Lipídio" value={`${dayTotal.fatG} g`} />
        <Row label="Fibra" value={`${dayTotal.fiberG} g`} />
        {target ? (
          <div className="mt-2 border-t border-slate-100 pt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Meta (avaliação): {target.kcal} kcal
            </p>
            {delta ? (
              <div className="space-y-1 text-xs">
                <DeltaRow label="Energia" v={delta.kcal} unit="kcal" />
                {target.macros ? (
                  <>
                    <DeltaRow label="Proteína" v={delta.protG} unit="g" />
                    <DeltaRow label="Carboidrato" v={delta.carbG} unit="g" />
                    <DeltaRow label="Lipídio" v={delta.fatG} unit="g" />
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            Sem meta — faça uma avaliação nutricional para comparar o plano com o alvo.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums text-slate-800">{value}</span>
    </div>
  )
}
function DeltaRow({ label, v, unit }: { label: string; v: number; unit: string }) {
  const over = v > 0
  const near = Math.abs(v) < (unit === 'kcal' ? 50 : 5)
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span
        className={`font-semibold tabular-nums ${near ? 'text-emerald-600' : over ? 'text-amber-600' : 'text-sky-600'}`}
      >
        {over ? '+' : ''}
        {Math.round(v * 10) / 10} {unit}
      </span>
    </div>
  )
}

// A API devolve nutrientes já escalados por item; ao carregar, reconstruímos a
// base (por 100 g equivalente) para a UI recomputar ao vivo conforme a grama.
function rescaleToBase(i: EditItem): EditItem {
  const f = i.grams > 0 ? 100 / i.grams : 0
  return {
    ...i,
    referenceGrams: 100,
    energyKcal: i.energyKcal * f,
    proteinG: i.proteinG * f,
    carbG: i.carbG * f,
    fatG: i.fatG * f,
    fiberG: i.fiberG === null ? null : i.fiberG * f,
  }
}

interface PlanApiView {
  id: string
  title: string
  status: 'rascunho' | 'prescrito'
  target: PlanMeta['target']
  meals: Array<{
    name: string
    timeLabel: string | null
    items: Array<{
      foodId: string | null
      name: string
      grams: number | null
      nutrients: Nutrients | null
    }>
  }>
}
