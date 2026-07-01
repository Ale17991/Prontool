'use client'

import { useEffect, useState, useTransition } from 'react'
import { Salad, Loader2, Plus, Trash2, ChevronDown, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Feature 032 — cadastro do plano de DIETA pela equipe.
 * Autossuficiente: GET/POST em /api/pacientes/[id]/dieta.
 * Modelo versionado: salvar cria uma nova versão e desativa a anterior.
 * Aparece no portal do paciente na seção "Dieta".
 */

interface ItemForm {
  food: string
  quantity: string
  notes: string
}
interface MealForm {
  name: string
  timeLabel: string
  notes: string
  items: ItemForm[]
}
interface DietPlan {
  id: string
  title: string
  notes: string | null
  active: boolean
  createdAt: string
  meals: Array<{
    name: string
    timeLabel: string | null
    notes: string | null
    items: Array<{ food: string; quantity: string | null; notes: string | null }>
  }>
}

const emptyItem = (): ItemForm => ({ food: '', quantity: '', notes: '' })
const emptyMeal = (): MealForm => ({ name: '', timeLabel: '', notes: '', items: [emptyItem()] })

function planToForm(p: DietPlan): { title: string; notes: string; meals: MealForm[] } {
  return {
    title: p.title,
    notes: p.notes ?? '',
    meals: p.meals.map((m) => ({
      name: m.name,
      timeLabel: m.timeLabel ?? '',
      notes: m.notes ?? '',
      items: m.items.map((it) => ({
        food: it.food,
        quantity: it.quantity ?? '',
        notes: it.notes ?? '',
      })),
    })),
  }
}

const strOrNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

export function DietEditor({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const base = `/api/pacientes/${patientId}/dieta`
  const [active, setActive] = useState<DietPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [meals, setMeals] = useState<MealForm[]>([emptyMeal()])

  // Reordenação por arrastar (drag nativo, sem dep). `dragIndex` = card em
  // movimento; `dragEnabled` = card com `draggable` ligado (só pela alça, pra
  // não atrapalhar a seleção de texto nos inputs).
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragEnabled, setDragEnabled] = useState<number | null>(null)

  function moveMeal(from: number, to: number) {
    setMeals((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved!)
      return next
    })
  }

  useEffect(() => {
    let off = false
    void (async () => {
      try {
        const res = await fetch(base)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { active: DietPlan | null }
        if (!off) setActive(data.active)
      } catch {
        if (!off) setError('Não foi possível carregar a dieta.')
      } finally {
        if (!off) setLoading(false)
      }
    })()
    return () => {
      off = true
    }
  }, [base])

  function openForm(prefill: boolean) {
    if (prefill && active) {
      const f = planToForm(active)
      setTitle(f.title)
      setNotes(f.notes)
      setMeals(f.meals.length ? f.meals : [emptyMeal()])
    } else {
      setTitle('')
      setNotes('')
      setMeals([emptyMeal()])
    }
    setError(null)
    setEditing(true)
  }

  function patchMeal(mi: number, patch: Partial<MealForm>) {
    setMeals((prev) => prev.map((m, i) => (i === mi ? { ...m, ...patch } : m)))
  }
  function patchItem(mi: number, ii: number, patch: Partial<ItemForm>) {
    setMeals((prev) =>
      prev.map((m, i) =>
        i === mi
          ? { ...m, items: m.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) }
          : m,
      ),
    )
  }

  function save() {
    const cleanMeals = meals
      .map((m) => ({
        name: m.name.trim(),
        timeLabel: strOrNull(m.timeLabel),
        notes: strOrNull(m.notes),
        items: m.items
          .filter((it) => it.food.trim() !== '')
          .map((it) => ({
            food: it.food.trim(),
            quantity: strOrNull(it.quantity),
            notes: strOrNull(it.notes),
          })),
      }))
      .filter((m) => m.name !== '')

    if (title.trim() === '') {
      setError('Dê um título ao plano alimentar.')
      return
    }
    if (cleanMeals.length === 0) {
      setError('Adicione ao menos uma refeição com nome.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), notes: strOrNull(notes), meals: cleanMeals }),
        })
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
          throw new Error(b.error?.message ?? `HTTP ${res.status}`)
        }
        const get = await fetch(base)
        if (get.ok) setActive(((await get.json()) as { active: DietPlan | null }).active)
        setEditing(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar.')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Salad className="h-4 w-4 text-primary" />
          Plano alimentar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500">
          Exibido ao paciente no portal (seção “Dieta”). Salvar cria uma nova versão e arquiva a
          anterior.
        </p>

        {loading ? (
          <p className="text-sm text-slate-400">Carregando…</p>
        ) : !editing ? (
          <>
            {active ? (
              <DietReadView plan={active} />
            ) : (
              <p className="text-sm text-slate-500">Nenhum plano alimentar ativo.</p>
            )}
            {canWrite ? (
              <Button
                size="sm"
                variant={active ? 'outline' : 'default'}
                onClick={() => openForm(Boolean(active))}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                {active ? 'Novo plano (a partir do atual)' : 'Criar plano alimentar'}
              </Button>
            ) : null}
          </>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="d_title" className="text-[11px]">
                  Título do plano
                </Label>
                <Input
                  id="d_title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Low carb moderado (~1600 kcal)"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="d_notes" className="text-[11px]">
                  Observações gerais
                </Label>
                <Input
                  id="d_notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex.: beber 2L de água/dia"
                />
              </div>
            </div>

            {meals.map((m, mi) => (
              <div
                key={mi}
                draggable={dragEnabled === mi}
                onDragStart={() => setDragIndex(mi)}
                onDragEnter={() => {
                  if (dragIndex !== null && dragIndex !== mi) {
                    moveMeal(dragIndex, mi)
                    setDragIndex(mi)
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragEnd={() => {
                  setDragIndex(null)
                  setDragEnabled(null)
                }}
                className={`rounded-lg border border-slate-200 bg-slate-50/50 p-3 transition-shadow ${
                  dragIndex === mi ? 'opacity-60 shadow-lg ring-2 ring-primary/40' : ''
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Arrastar para reordenar"
                    title="Arraste para reposicionar"
                    onMouseDown={() => setDragEnabled(mi)}
                    onMouseUp={() => setDragEnabled(null)}
                    className="cursor-grab touch-none text-slate-400 hover:text-slate-600 active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                  <Input
                    value={m.name}
                    onChange={(e) => patchMeal(mi, { name: e.target.value })}
                    placeholder="Refeição (ex.: Café da manhã)"
                    className="h-8 font-semibold"
                  />
                  <Input
                    value={m.timeLabel}
                    onChange={(e) => patchMeal(mi, { timeLabel: e.target.value })}
                    placeholder="Horário"
                    className="h-8 w-28"
                  />
                  {meals.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setMeals((p) => p.filter((_, i) => i !== mi))}
                      className="text-slate-400 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>

                <div className="space-y-2">
                  {m.items.map((it, ii) => (
                    <div key={ii} className="grid grid-cols-12 items-center gap-1.5">
                      <Input
                        className="col-span-5 h-8"
                        value={it.food}
                        onChange={(ev) => patchItem(mi, ii, { food: ev.target.value })}
                        placeholder="Alimento"
                      />
                      <Input
                        className="col-span-3 h-8"
                        value={it.quantity}
                        onChange={(ev) => patchItem(mi, ii, { quantity: ev.target.value })}
                        placeholder="Quantidade"
                      />
                      <Input
                        className="col-span-3 h-8"
                        value={it.notes}
                        onChange={(ev) => patchItem(mi, ii, { notes: ev.target.value })}
                        placeholder="obs"
                      />
                      <button
                        type="button"
                        onClick={() => patchMeal(mi, { items: m.items.filter((_, j) => j !== ii) })}
                        className="col-span-1 flex justify-center text-slate-400 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => patchMeal(mi, { items: [...m.items, emptyItem()] })}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" /> alimento
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setMeals((p) => [...p, emptyMeal()])}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> adicionar refeição
            </button>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              {error ? <span className="text-xs text-destructive">{error}</span> : <span />}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button size="sm" onClick={save} disabled={pending}>
                  {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                  Salvar plano
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DietReadView({ plan }: { plan: DietPlan }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between"
      >
        <span className="text-sm font-semibold text-slate-800">{plan.title}</span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {plan.notes ? <p className="mt-1 text-xs text-slate-500">{plan.notes}</p> : null}
      {open ? (
        <div className="mt-3 space-y-3">
          {plan.meals.map((m, i) => (
            <div key={i}>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {m.name}
                {m.timeLabel ? (
                  <span className="ml-1 font-normal normal-case text-slate-400">
                    · {m.timeLabel}
                  </span>
                ) : null}
              </p>
              <ul className="mt-1 space-y-0.5">
                {m.items.map((it, j) => (
                  <li key={j} className="text-sm text-slate-700">
                    {it.food}
                    {it.quantity ? <span className="text-slate-500"> — {it.quantity}</span> : null}
                    {it.notes ? <span className="text-slate-400"> ({it.notes})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
