'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Printer, Save, Search, Trash2, UtensilsCrossed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PatientTypeahead, type PatientTypeaheadValue } from '@/components/patients/patient-typeahead'
import { itemNutrients, addNutrients, roundNutrients, type Nutrients } from '@/lib/core/nutrition/diet/totals'
import { MICRONUTRIENTS_PRIMARY, micronutrientDef, type MicronutrientMap } from '@/lib/core/nutrition/micronutrients'
import type { FoodDTO } from '@/lib/core/nutrition/foods/search'

interface Item {
  key: string
  foodId: string
  name: string
  referenceGrams: number
  energyKcal: number
  proteinG: number
  carbG: number
  fatG: number
  fiberG: number | null
  micros?: MicronutrientMap
  grams: number
}
interface Meal {
  key: string
  name: string
  items: Item[]
}
interface AdequacyItemView {
  nutrientKey: string
  label: string
  unit: string
  total: number
  dri: number | null
  pct: number | null
  class: 'abaixo' | 'adequado' | 'acima' | 'sem_referencia'
}
interface AdequacyView {
  adequacy: { items: AdequacyItemView[]; deficits: number; excesses: number } | null
  patient?: { ageYears: number; sex: string }
  need?: { age: boolean; sex: boolean }
}

let seq = 0
const nextKey = () => `r${++seq}`

function toNutrients(it: Item): Nutrients {
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
        micros: it.micros,
      },
    }),
  )
}
function sum(list: Nutrients[]): Nutrients {
  return roundNutrients(list.reduce(addNutrients, { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 }))
}
function rescale(scaled: Nutrients, grams: number): Nutrients {
  const f = grams > 0 ? 100 / grams : 0
  let micros: MicronutrientMap | undefined
  if (scaled.micros) {
    micros = {}
    for (const [k, v] of Object.entries(scaled.micros)) micros[k] = v * f
  }
  return {
    energyKcal: scaled.energyKcal * f,
    proteinG: scaled.proteinG * f,
    carbG: scaled.carbG * f,
    fatG: scaled.fatG * f,
    fiberG: scaled.fiberG * f,
    micros,
  }
}

export function RecordatorioClient() {
  const today = new Date().toISOString().slice(0, 10)
  const [patient, setPatient] = useState<PatientTypeaheadValue | null>(null)
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [meals, setMeals] = useState<Meal[]>([])
  const [summaries, setSummaries] = useState<{ id: string; recallDate: string; totalKcal: number }[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [adequacy, setAdequacy] = useState<AdequacyView | null>(null)
  const [adeqLoading, setAdeqLoading] = useState(false)

  const load = useCallback(async (patientId: string) => {
    const res = await fetch(`/api/pacientes/${patientId}/recordatorio`)
    if (!res.ok) return
    const data = (await res.json()) as {
      summaries: { id: string; recallDate: string; totalKcal: number }[]
      latest: {
        recallDate: string
        notes: string | null
        meals: { name: string; items: { foodId: string; name: string; grams: number | null; nutrients: Nutrients | null }[] }[]
      } | null
    }
    setSummaries(data.summaries)
    if (data.latest) {
      setDate(data.latest.recallDate)
      setNotes(data.latest.notes ?? '')
      setMeals(
        data.latest.meals.map((m) => ({
          key: nextKey(),
          name: m.name,
          items: m.items
            .filter((i) => i.grams !== null)
            .map((i) => {
              const base = rescale(i.nutrients ?? { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 }, i.grams!)
              return {
                key: nextKey(),
                foodId: i.foodId,
                name: i.name,
                referenceGrams: 100,
                energyKcal: base.energyKcal,
                proteinG: base.proteinG,
                carbG: base.carbG,
                fatG: base.fatG,
                fiberG: base.fiberG,
                micros: base.micros,
                grams: i.grams!,
              }
            }),
        })),
      )
    } else {
      setMeals([])
    }
  }, [])

  useEffect(() => {
    if (patient) void load(patient.id)
    else {
      setMeals([])
      setSummaries([])
      setAdequacy(null)
    }
  }, [patient, load])

  const dayTotal = useMemo(() => sum(meals.flatMap((m) => m.items.map(toNutrients))), [meals])

  function addMeal() {
    setMeals((v) => [...v, { key: nextKey(), name: 'Refeição', items: [] }])
  }
  function addItem(mealKey: string, food: FoodDTO) {
    const grams = food.measures.find((m) => m.isDefault)?.grams ?? food.referenceGrams
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
                  micros: food.micronutrients ?? undefined,
                  grams,
                },
              ],
            }
          : m,
      ),
    )
  }

  async function save() {
    if (!patient) return
    setSaving(true)
    setMsg(null)
    try {
      const body = {
        recall_date: date,
        notes: notes.trim() || null,
        meals: meals.map((m, mi) => ({
          name: m.name,
          position: mi,
          items: m.items.map((i) => ({ food_id: i.foodId, grams: i.grams })),
        })),
      }
      const res = await fetch(`/api/pacientes/${patient.id}/recordatorio`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setMsg('Falha ao salvar o recordatório.')
        return
      }
      setMsg('Recordatório salvo.')
      await load(patient.id)
    } finally {
      setSaving(false)
    }
  }

  async function analyze() {
    if (!patient) return
    setAdeqLoading(true)
    try {
      await save()
      const res = await fetch(`/api/pacientes/${patient.id}/adequacao?source=recordatorio`)
      setAdequacy(res.ok ? ((await res.json()) as AdequacyView) : null)
    } finally {
      setAdeqLoading(false)
    }
  }

  const cls = (c: AdequacyItemView['class']) =>
    c === 'adequado' ? 'text-emerald-600' : c === 'acima' ? 'text-amber-600' : c === 'abaixo' ? 'text-link' : 'text-slate-400'

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardContent className="grid gap-3 pt-6 md:grid-cols-3">
            <div className="md:col-span-2">
              <Label>Paciente</Label>
              <PatientTypeahead value={patient?.id ?? null} onChange={setPatient} allowCreate />
            </div>
            <div>
              <Label htmlFor="r_date">Data</Label>
              <Input id="r_date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {!patient ? (
          <p className="text-sm text-slate-400">Selecione um paciente para registrar o recordatório.</p>
        ) : (
          <>
            {meals.map((meal) => {
              const mt = sum(meal.items.map(toNutrients))
              return (
                <Card key={meal.key}>
                  <CardHeader className="flex flex-row items-center gap-2 pb-2">
                    <UtensilsCrossed className="h-4 w-4 text-primary" />
                    <Input
                      className="h-8 max-w-[220px] font-semibold"
                      value={meal.name}
                      onChange={(e) => setMeals((v) => v.map((m) => (m.key === meal.key ? { ...m, name: e.target.value } : m)))}
                    />
                    <span className="ml-auto text-xs font-semibold tabular-nums text-slate-600">{mt.energyKcal} kcal</span>
                    <button
                      type="button"
                      onClick={() => setMeals((v) => v.filter((m) => m.key !== meal.key))}
                      className="text-slate-400 hover:text-destructive"
                    >
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
                            onChange={(e) =>
                              setMeals((v) =>
                                v.map((m) =>
                                  m.key === meal.key
                                    ? {
                                        ...m,
                                        items: m.items.map((x) =>
                                          x.key === it.key ? { ...x, grams: Number(e.target.value.replace(',', '.')) || 0 } : x,
                                        ),
                                      }
                                    : m,
                                ),
                              )
                            }
                          />
                          <span className="text-xs text-slate-400">g</span>
                          <span className="w-16 text-right text-xs tabular-nums text-slate-500">{n.energyKcal} kcal</span>
                          <button
                            type="button"
                            onClick={() =>
                              setMeals((v) =>
                                v.map((m) => (m.key === meal.key ? { ...m, items: m.items.filter((x) => x.key !== it.key) } : m)),
                              )
                            }
                            className="text-slate-300 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )
                    })}
                    <FoodSearch onPick={(f) => addItem(meal.key, f)} />
                  </CardContent>
                </Card>
              )
            })}
            <Button variant="outline" size="sm" onClick={addMeal} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Adicionar refeição
            </Button>
            <div>
              <Label htmlFor="r_notes">Observações</Label>
              <Input id="r_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </>
        )}
      </div>

      <div className="space-y-4">
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
            {dayTotal.micros && MICRONUTRIENTS_PRIMARY.some((k) => dayTotal.micros![k] !== undefined) ? (
              <div className="mt-2 border-t border-slate-100 pt-2">
                {MICRONUTRIENTS_PRIMARY.filter((k) => dayTotal.micros![k] !== undefined).map((k) => {
                  const d = micronutrientDef(k)
                  return <Row key={k} label={d?.label ?? k} value={`${Math.round(dayTotal.micros![k]! * 10) / 10} ${d?.unit ?? ''}`} />
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {patient ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={save} disabled={saving} className="flex-1 gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
            </Button>
            <Button onClick={analyze} disabled={adeqLoading} className="flex-1 gap-1.5">
              {adeqLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Analisar (DRI)
            </Button>
          </div>
        ) : null}
        {/*
          Feature 054 US4 — o impresso lê o recordatório GRAVADO daquela data, não
          o rascunho da tela. Salvar antes de imprimir é o fluxo; imprimir estado
          não salvo entregaria ao paciente um papel que o sistema não guarda.
        */}
        {patient && summaries.some((s) => s.recallDate === date) ? (
          <Button variant="outline" size="sm" className="w-full gap-1.5" asChild>
            <a
              href={`/api/pacientes/${patient.id}/recordatorio/pdf?data=${date}`}
              target="_blank"
              rel="noreferrer"
            >
              <Printer className="h-3.5 w-3.5" /> Imprimir recordatório
            </a>
          </Button>
        ) : null}
        {msg ? <p className="text-xs text-slate-500">{msg}</p> : null}

        {adequacy ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Adequação (DRI)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              {adequacy.need && (adequacy.need.age || adequacy.need.sex) ? (
                <p className="text-amber-600">Informe idade e sexo no cadastro do paciente.</p>
              ) : adequacy.adequacy ? (
                <>
                  <p className="mb-1 text-[11px] text-slate-500">
                    {adequacy.adequacy.deficits} carência(s) · {adequacy.adequacy.excesses} excesso(s)
                  </p>
                  {adequacy.adequacy.items.map((i) => (
                    <div key={i.nutrientKey} className="flex items-center justify-between">
                      <span className="text-slate-600">{i.label}</span>
                      <span className={`tabular-nums ${cls(i.class)}`}>
                        {i.total}/{i.dri ?? '—'} {i.unit}
                        {i.pct !== null ? ` · ${i.pct}%` : ''}
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-slate-400">Salve um recordatório com itens.</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {summaries.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Histórico</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              {summaries.map((s) => (
                <div key={s.id} className="flex items-center justify-between">
                  <span className="text-slate-600">{s.recallDate}</span>
                  <span className="tabular-nums text-slate-500">{s.totalKcal} kcal</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
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
