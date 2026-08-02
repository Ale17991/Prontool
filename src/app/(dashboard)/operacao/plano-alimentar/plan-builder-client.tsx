'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers, Loader2, Plus, Save, Search, Stamp, Trash2, UtensilsCrossed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PatientTypeahead, type PatientTypeaheadValue } from '@/components/patients/patient-typeahead'
import {
  itemNutrients,
  addNutrients,
  roundNutrients,
  targetDelta,
  type Nutrients,
} from '@/lib/core/nutrition/diet/totals'
import {
  MICRONUTRIENTS_PRIMARY,
  micronutrientDef,
  type MicronutrientMap,
} from '@/lib/core/nutrition/micronutrients'
import type { FoodDTO } from '@/lib/core/nutrition/foods/search'
import {
  distributeMacros,
  suggestedShares,
  type MealTarget,
} from '@/lib/core/nutrition/macro-distribution'

// ---- estado local do cardápio (edição) ---------------------------------
interface EditItem {
  key: string
  kind: 'food' | 'group'
  // Alimento único (kind === 'food'): base por `referenceGrams`, escala por grama.
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
  // Grupo / lista de substituição (kind === 'group'): 1 porção padronizada.
  equivalenceListId?: string
  groupOptions?: { foodId: string; name: string; grams: number }[]
  groupReferenceKcal?: number | null
  groupNutrients?: Nutrients
}
interface EditMeal {
  key: string
  name: string
  timeLabel: string
  /** Fatia do VET desta refeição, em %. `null` = sem meta própria. */
  targetPct: number | null
  items: EditItem[]
}
/** Grupo (lista de substituição) como devolvido por /api/alimentos/grupos. */
interface GroupDTO {
  id: string
  name: string
  referenceKcal: number | null
  isCustom: boolean
  items: { foodId: string; name: string; grams: number }[]
  nutrients: Nutrients
}
interface PlanMeta {
  id: string | null
  status: 'rascunho' | 'prescrito'
  target: { kcal: number; macros: { protG: number; carbG: number; fatG: number } | null; assessmentId: string | null } | null
}

let seq = 0
const nextKey = () => `k${++seq}`

function toNutrients(it: EditItem): Nutrients {
  if (it.kind === 'group') return roundNutrients(it.groupNutrients ?? { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 })
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
  return roundNutrients(
    list.reduce(addNutrients, { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 }),
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
  const [groups, setGroups] = useState<GroupDTO[]>([])
  const [adequacy, setAdequacy] = useState<AdequacyView | null>(null)
  const [adeqLoading, setAdeqLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/alimentos/grupos')
      if (res.ok) {
        const { equivalenceLists } = (await res.json()) as { equivalenceLists: GroupDTO[] }
        setGroups(equivalenceLists ?? [])
      }
    })()
  }, [])

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
            targetPct: m.targetPct ?? null,
            items: m.items
              .map((i): EditItem | null => {
                // Grupo (lista de substituição): 1 porção, nutrientes fixos.
                if (i.isGroup && i.equivalenceListId) {
                  return {
                    key: nextKey(),
                    kind: 'group',
                    foodId: '',
                    name: i.name,
                    referenceGrams: 100,
                    energyKcal: 0,
                    proteinG: 0,
                    carbG: 0,
                    fatG: 0,
                    fiberG: null,
                    grams: 0,
                    equivalenceListId: i.equivalenceListId,
                    groupOptions: i.groupOptions ?? [],
                    groupReferenceKcal: i.groupReferenceKcal ?? null,
                    groupNutrients: i.nutrients ?? { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 },
                  }
                }
                // Alimento único: nutrientes vêm já escalados; reconstruímos a
                // base (100 g equiv.) para a UI recomputar por grama.
                if (i.foodId && i.grams !== null) {
                  return rescaleToBase({
                    key: nextKey(),
                    kind: 'food',
                    foodId: i.foodId,
                    name: i.name,
                    referenceGrams: 100,
                    energyKcal: i.nutrients?.energyKcal ?? 0,
                    proteinG: i.nutrients?.proteinG ?? 0,
                    carbG: i.nutrients?.carbG ?? 0,
                    fatG: i.nutrients?.fatG ?? 0,
                    fiberG: i.nutrients?.fiberG ?? null,
                    micros: i.nutrients?.micros,
                    grams: i.grams,
                  })
                }
                return null
              })
              .filter((x): x is EditItem => x !== null),
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

  /**
   * Meta de cada refeição. Só existe quando a avaliação definiu VET e macros —
   * sem meta diária não há o que repartir, e inventar uma seria pior que não
   * mostrar nada.
   */
  const distribution = useMemo(() => {
    const t = meta.target
    if (!t || !t.macros) return null
    return distributeMacros({
      targetKcal: t.kcal,
      macros: { protG: t.macros.protG, carbG: t.macros.carbG, lipG: t.macros.fatG },
      meals: meals.map((m) => ({ key: m.key, name: m.name, pct: m.targetPct ?? 0 })),
    })
  }, [meals, meta.target])

  const targetByMeal = useMemo(() => {
    const map = new Map<string, MealTarget>()
    for (const t of distribution?.meals ?? []) {
      // Refeição sem % informada não recebe meta: 0% é meta de não comer nada,
      // e mostrar isso como alvo faria toda refeição nova nascer "estourada".
      const m = meals.find((x) => x.key === t.key)
      if (m?.targetPct === null || m?.targetPct === undefined) continue
      map.set(t.key, t)
    }
    return map
  }, [distribution, meals])

  /** Reparte o dia entre as refeições existentes, no padrão de consultório. */
  function distribuirSugerido() {
    setMeals((v) => {
      const shares = suggestedShares(v.length)
      return v.map((m, i) => ({ ...m, targetPct: shares[i] ?? null }))
    })
  }

  function addMeal() {
    setMeals((v) => [...v, { key: nextKey(), name: 'Refeição', timeLabel: '', targetPct: null, items: [] }])
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
                  kind: 'food',
                  foodId: food.id,
                  name: food.name,
                  referenceGrams: food.referenceGrams,
                  energyKcal: food.energyKcal,
                  proteinG: food.proteinG,
                  carbG: food.carbG,
                  fatG: food.fatG,
                  fiberG: food.fiberG,
                  micros: food.micronutrients ?? undefined,
                  grams: defaultGrams,
                },
              ],
            }
          : m,
      ),
    )
  }
  function addGroup(mealKey: string, group: GroupDTO) {
    setMeals((v) =>
      v.map((m) =>
        m.key === mealKey
          ? {
              ...m,
              items: [
                ...m.items,
                {
                  key: nextKey(),
                  kind: 'group',
                  foodId: '',
                  name: group.name,
                  referenceGrams: 100,
                  energyKcal: 0,
                  proteinG: 0,
                  carbG: 0,
                  fatG: 0,
                  fiberG: null,
                  grams: 0,
                  equivalenceListId: group.id,
                  groupOptions: group.items,
                  groupReferenceKcal: group.referenceKcal,
                  groupNutrients: group.nutrients,
                },
              ],
            }
          : m,
      ),
    )
  }
  function removeGroupOption(mealKey: string, itemKey: string, foodId: string) {
    setMeals((v) =>
      v.map((m) =>
        m.key === mealKey
          ? {
              ...m,
              items: m.items.map((it) =>
                it.key === itemKey
                  ? { ...it, groupOptions: (it.groupOptions ?? []).filter((o) => o.foodId !== foodId) }
                  : it,
              ),
            }
          : m,
      ),
    )
  }
  function addGroupOption(mealKey: string, itemKey: string, food: FoodDTO) {
    setMeals((v) =>
      v.map((m) =>
        m.key === mealKey
          ? {
              ...m,
              items: m.items.map((it) => {
                if (it.key !== itemKey) return it
                const opts = it.groupOptions ?? []
                if (opts.some((o) => o.foodId === food.id)) return it
                // Grama que bate a meta de kcal do grupo (regra de três).
                const target = it.groupReferenceKcal ?? 0
                const grams =
                  target > 0 && food.energyKcal > 0
                    ? Math.round((target * food.referenceGrams) / food.energyKcal)
                    : (food.measures.find((mm) => mm.isDefault)?.grams ?? food.referenceGrams)
                return { ...it, groupOptions: [...opts, { foodId: food.id, name: food.name, grams }] }
              }),
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
          target_pct: m.targetPct,
          items: m.items.map((i) =>
            i.kind === 'group'
              ? {
                  equivalence_list_id: i.equivalenceListId,
                  notes: i.name,
                  group_options: (i.groupOptions ?? []).map((o) => ({ food_id: o.foodId, grams: o.grams })),
                }
              : { food_id: i.foodId, grams: i.grams },
          ),
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

  async function loadAdequacy() {
    if (!patient) return
    setAdeqLoading(true)
    setMsg(null)
    try {
      await save() // persiste o rascunho para a análise refletir o cardápio atual
      const res = await fetch(`/api/pacientes/${patient.id}/adequacao`)
      setAdequacy(res.ok ? ((await res.json()) as AdequacyView) : null)
    } finally {
      setAdeqLoading(false)
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
      setMsg('Plano enviado — já aparece no portal do paciente.')
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
              <PatientTypeahead value={patient?.id ?? null} onChange={setPatient} allowCreate />
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
                Este plano foi <strong>enviado ao paciente</strong> (visível no portal). Edite e salve para
                criar uma nova versão — depois envie de novo.
              </p>
            ) : (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Rascunho — <strong>ainda não aparece no portal</strong> do paciente. Clique em
                “Enviar ao paciente” quando estiver pronto.
              </p>
            )}
            {meals.map((meal) => (
              <MealCard
                key={meal.key}
                meal={meal}
                groups={groups}
                onName={(name) => setMeals((v) => v.map((m) => (m.key === meal.key ? { ...m, name } : m)))}
                onTime={(t) => setMeals((v) => v.map((m) => (m.key === meal.key ? { ...m, timeLabel: t } : m)))}
                onAddItem={(f) => addItem(meal.key, f)}
                onAddGroup={(g) => addGroup(meal.key, g)}
                onGrams={(ik, g) => setItemGrams(meal.key, ik, g)}
                onRemoveItem={(ik) => removeItem(meal.key, ik)}
                onRemoveGroupOption={(ik, fid) => removeGroupOption(meal.key, ik, fid)}
                onAddGroupOption={(ik, f) => addGroupOption(meal.key, ik, f)}
                onRemove={() => removeMeal(meal.key)}
                onTargetPct={(pct) =>
                  setMeals((v) => v.map((m) => (m.key === meal.key ? { ...m, targetPct: pct } : m)))
                }
                target={targetByMeal.get(meal.key) ?? null}
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
        {distribution && meals.length > 0 ? (
          <DistributionPanel
            pctSum={distribution.pctSum}
            balanced={distribution.balanced}
            unallocatedKcal={distribution.unallocatedKcal}
            onDistribute={distribuirSugerido}
          />
        ) : null}
        {patient ? (
          <AdequacyPanel data={adequacy} loading={adeqLoading} onAnalyze={loadAdequacy} />
        ) : null}
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
                {prescribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stamp className="h-4 w-4" />} Enviar ao
                paciente
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
  groups,
  onName,
  onTime,
  onAddItem,
  onAddGroup,
  onGrams,
  onRemoveItem,
  onRemoveGroupOption,
  onAddGroupOption,
  onRemove,
  onTargetPct,
  target,
}: {
  meal: EditMeal
  groups: GroupDTO[]
  onName: (v: string) => void
  onTime: (v: string) => void
  onAddItem: (f: FoodDTO) => void
  onAddGroup: (g: GroupDTO) => void
  onGrams: (itemKey: string, grams: number) => void
  onRemoveItem: (itemKey: string) => void
  onRemoveGroupOption: (itemKey: string, foodId: string) => void
  onAddGroupOption: (itemKey: string, food: FoodDTO) => void
  onRemove: () => void
  onTargetPct: (pct: number | null) => void
  target: MealTarget | null
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
        <div className="ml-auto flex items-center gap-1">
          <Input
            className="h-8 w-16 text-xs tabular-nums"
            placeholder="%"
            inputMode="decimal"
            value={meal.targetPct ?? ''}
            onChange={(e) => {
              const raw = e.target.value.trim().replace(',', '.')
              // Campo vazio volta a "sem meta" — que é diferente de 0%.
              if (raw === '') return onTargetPct(null)
              const n = Number(raw)
              if (Number.isFinite(n) && n >= 0 && n <= 100) onTargetPct(n)
            }}
            title="Fatia do dia destinada a esta refeição"
          />
          <span className="text-[10px] text-slate-400">%</span>
        </div>
        <span className="text-xs font-semibold tabular-nums text-slate-600">
          {total.energyKcal} kcal
        </span>
        <button type="button" onClick={onRemove} className="text-slate-400 hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="space-y-2">
        {meal.items.map((it) => {
          const n = toNutrients(it)
          if (it.kind === 'group') {
            return (
              <div key={it.key} className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="flex-1 truncate font-medium">{it.name}</span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    grupo
                  </span>
                  <span className="w-16 text-right text-xs tabular-nums text-slate-500">{n.energyKcal} kcal</span>
                  <button
                    type="button"
                    onClick={() => onRemoveItem(it.key)}
                    className="text-slate-300 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1 pl-5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Opções — o paciente escolhe uma
                </p>
                <ul className="mt-0.5 space-y-0.5 pl-5">
                  {(it.groupOptions ?? []).map((o) => (
                    <li key={o.foodId} className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="flex-1 truncate">{o.name}</span>
                      <span className="tabular-nums text-slate-400">{o.grams} g</span>
                      <button
                        type="button"
                        onClick={() => onRemoveGroupOption(it.key, o.foodId)}
                        className="text-slate-300 hover:text-destructive"
                        title="Remover esta opção para este paciente"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                  {(it.groupOptions ?? []).length === 0 ? (
                    <li className="text-[11px] text-amber-600">Sem opções — adicione ao menos uma.</li>
                  ) : null}
                </ul>
                <div className="mt-1 pl-5">
                  <FoodSearch placeholder="Adicionar opção…" onPick={(f) => onAddGroupOption(it.key, f)} />
                </div>
              </div>
            )
          }
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
        <GroupPicker groups={groups} onPick={onAddGroup} />
        {target ? <MealTargetRow target={target} actual={total} /> : null}
      </CardContent>
    </Card>
  )
}

function GroupPicker({ groups, onPick }: { groups: GroupDTO[]; onPick: (g: GroupDTO) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        className="h-8 gap-1.5 text-xs text-primary hover:bg-primary/5"
      >
        <Layers className="h-3.5 w-3.5" /> Adicionar grupo (OU)
      </Button>
      {open ? (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {groups.length === 0 ? (
            <p className="px-3 py-2 text-xs leading-snug text-slate-500">
              Nenhum grupo criado ainda. Crie em{' '}
              <span className="font-medium text-slate-700">
                Configurações → Alimentos → Listas de substituição
              </span>
              .
            </p>
          ) : (
            groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  onPick(g)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <span className="truncate">
                  {g.name}
                  {g.isCustom ? null : <span className="ml-1 text-[10px] text-slate-400">(base)</span>}
                </span>
                <span className="ml-2 shrink-0 text-[10px] text-slate-400">
                  {Math.round(g.nutrients.energyKcal)} kcal
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

function FoodSearch({ onPick, placeholder }: { onPick: (f: FoodDTO) => void; placeholder?: string }) {
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
          placeholder={placeholder ?? 'Adicionar alimento…'}
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
        {dayTotal.micros && MICRONUTRIENTS_PRIMARY.some((k) => dayTotal.micros![k] !== undefined) ? (
          <div className="mt-2 border-t border-slate-100 pt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Micronutrientes
            </p>
            {MICRONUTRIENTS_PRIMARY.filter((k) => dayTotal.micros![k] !== undefined).map((k) => {
              const def = micronutrientDef(k)
              return (
                <Row
                  key={k}
                  label={def?.label ?? k}
                  value={`${Math.round(dayTotal.micros![k]! * 10) / 10} ${def?.unit ?? ''}`}
                />
              )
            })}
          </div>
        ) : null}
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
  patient?: { ageYears: number; sex: string; state: string }
  need?: { age: boolean; sex: boolean }
}

function AdequacyPanel({
  data,
  loading,
  onAnalyze,
}: {
  data: AdequacyView | null
  loading: boolean
  onAnalyze: () => void
}) {
  const cls = (c: AdequacyItemView['class']) =>
    c === 'adequado'
      ? 'text-emerald-600'
      : c === 'acima'
        ? 'text-amber-600'
        : c === 'abaixo'
          ? 'text-sky-600'
          : 'text-slate-400'
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Adequação (DRI)</CardTitle>
        <Button size="sm" variant="outline" onClick={onAnalyze} disabled={loading} className="h-7 gap-1.5 text-xs">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Analisar
        </Button>
      </CardHeader>
      <CardContent className="space-y-1 text-xs">
        {!data ? (
          <p className="text-slate-400">Clique em “Analisar” para comparar o plano com a recomendação do paciente.</p>
        ) : data.need && (data.need.age || data.need.sex) ? (
          <p className="text-amber-600">Informe idade (data de nascimento) e sexo no cadastro do paciente.</p>
        ) : !data.adequacy ? (
          <p className="text-slate-400">Salve um plano com itens para analisar.</p>
        ) : (
          <>
            <p className="mb-1 text-[11px] text-slate-500">
              {data.adequacy.deficits} carência(s) · {data.adequacy.excesses} excesso(s)
              {data.patient ? ` · ${data.patient.ageYears}a ${data.patient.sex}` : ''}
            </p>
            {data.adequacy.items.map((i) => (
              <div key={i.nutrientKey} className="flex items-center justify-between">
                <span className="text-slate-600">{i.label}</span>
                <span className={`tabular-nums ${cls(i.class)}`}>
                  {i.total}/{i.dri ?? '—'} {i.unit}
                  {i.pct !== null ? ` · ${i.pct}%` : ''}
                </span>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// A API devolve nutrientes já escalados por item; ao carregar, reconstruímos a
// base (por 100 g equivalente) para a UI recomputar ao vivo conforme a grama.
function rescaleToBase(i: EditItem): EditItem {
  const f = i.grams > 0 ? 100 / i.grams : 0
  let micros: MicronutrientMap | undefined
  if (i.micros) {
    micros = {}
    for (const [k, v] of Object.entries(i.micros)) micros[k] = v * f
  }
  return {
    ...i,
    referenceGrams: 100,
    energyKcal: i.energyKcal * f,
    proteinG: i.proteinG * f,
    carbG: i.carbG * f,
    fatG: i.fatG * f,
    fiberG: i.fiberG === null ? null : i.fiberG * f,
    micros,
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
    targetPct: number | null
    items: Array<{
      foodId: string | null
      name: string
      grams: number | null
      equivalenceListId: string | null
      isGroup: boolean
      groupOptions: { foodId: string; name: string; grams: number }[] | null
      groupReferenceKcal: number | null
      nutrients: Nutrients | null
    }>
  }>
}

/**
 * Meta desta refeição contra o que já foi montado. A diferença é o número que
 * importa: sem ela a nutricionista teria que subtrair de cabeça, refeição por
 * refeição, para saber onde pesou a mão.
 */
function MealTargetRow({ target, actual }: { target: MealTarget; actual: Nutrients }) {
  const r = (n: number) => Math.round(n)
  const diffKcal = actual.energyKcal - target.kcal
  // Folga de 5% do alvo: exigir bater na casa da kcal transformaria o montador
  // num jogo de encaixe, e a precisão do dado de alimento não sustenta isso.
  const tol = Math.max(target.kcal * 0.05, 20)
  const cor =
    Math.abs(diffKcal) <= tol
      ? 'text-emerald-600'
      : diffKcal > 0
        ? 'text-amber-600'
        : 'text-sky-600'

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-slate-50 px-2 py-1.5 text-[11px]">
      <span className="font-semibold text-slate-500">
        Meta {target.pct}% · {r(target.kcal)} kcal
      </span>
      <span className="text-slate-400">
        P {r(target.protG)}g · C {r(target.carbG)}g · G {r(target.lipG)}g
      </span>
      <span className={`ml-auto font-semibold tabular-nums ${cor}`}>
        {diffKcal >= 0 ? '+' : ''}
        {r(diffKcal)} kcal
      </span>
    </div>
  )
}

/**
 * Fechamento da distribuição do dia. Existe para responder uma pergunta só:
 * "o que eu reparti entre as refeições cobre o dia inteiro?".
 */
function DistributionPanel({
  pctSum,
  balanced,
  unallocatedKcal,
  onDistribute,
}: {
  pctSum: number
  balanced: boolean
  unallocatedKcal: number
  onDistribute: () => void
}) {
  const sobra = Math.round(unallocatedKcal)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Distribuição do dia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">Repartido</span>
          <span
            className={`font-semibold tabular-nums ${balanced ? 'text-emerald-600' : 'text-amber-600'}`}
          >
            {Math.round(pctSum * 100) / 100}%
          </span>
        </div>
        {!balanced ? (
          <p className="text-[11px] text-amber-700">
            {sobra > 0
              ? `Faltam ${sobra} kcal sem refeição — some ${Math.round((100 - pctSum) * 100) / 100}% em alguma.`
              : `Passou ${Math.abs(sobra)} kcal do dia — as refeições somam mais que 100%.`}
          </p>
        ) : (
          <p className="text-[11px] text-emerald-700">O dia inteiro está repartido.</p>
        )}
        <Button variant="outline" size="sm" className="w-full" onClick={onDistribute}>
          Repartir automaticamente
        </Button>
        <p className="text-[10px] text-slate-400">
          Ponto de partida por número de refeições — ajuste como preferir.
        </p>
      </CardContent>
    </Card>
  )
}
