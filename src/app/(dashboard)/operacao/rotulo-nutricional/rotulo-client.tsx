'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Copy,
  FileDown,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { composeLabel, type LabelNutrientRow } from '@/lib/core/nutrition/labeling/compose'
import {
  FRONT_OF_PACK_LABEL,
  type FrontOfPackNutrient,
  type LabelBasis,
} from '@/lib/core/nutrition/labeling/reference'
import { formatDeclared } from '@/lib/core/nutrition/labeling/rounding'
import type { FoodDTO } from '@/lib/core/nutrition/foods/search'

/**
 * Feature 052 — montagem do rótulo com a tabela recalculando ao vivo.
 *
 * A tabela usa a MESMA função do servidor (`composeLabel`), então o número da
 * tela nunca diverge do que vai para o PDF. Os três estados de linha —
 * calculado, sobrescrito e incompleto — são visualmente distintos de propósito:
 * confundir "praticamente não tem" com "não sei quanto tem" é falsear rótulo.
 */

interface Ingredient {
  key: string
  foodId: string
  name: string
  grams: number
  food: {
    referenceGrams: number
    energyKcal: number
    proteinG: number
    carbG: number
    fatG: number
    fiberG: number | null
    micros: Record<string, number> | null
  }
}

interface SavedLabel {
  id: string
  productName: string
  clientName: string | null
  basis: LabelBasis
  incomplete: boolean
  updatedAt: string
}

let seq = 0
const nextKey = () => `i${++seq}`

const EMPTY_FORM = {
  productName: '',
  clientName: '',
  basis: 'solido' as LabelBasis,
  totalYield: 1000,
  portionSize: 100,
  householdMeasure: '',
  portionsPerPackage: '' as string,
  ingredientsText: '',
  allergensText: '',
  storageText: '',
}

export function RotuloClient() {
  const [labels, setLabels] = useState<SavedLabel[]>([])
  const [labelId, setLabelId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [manualValues, setManualValues] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  const set = <K extends keyof typeof EMPTY_FORM>(k: K, v: (typeof EMPTY_FORM)[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const loadList = useCallback(async () => {
    const res = await fetch('/api/rotulos')
    if (res.ok) setLabels(((await res.json()) as { labels: SavedLabel[] }).labels)
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const result = useMemo(
    () =>
      composeLabel({
        ingredients: ingredients.map((i) => ({
          foodId: i.foodId,
          name: i.name,
          grams: i.grams,
          food: i.food,
        })),
        totalYield: form.totalYield,
        portionSize: form.portionSize,
        basis: form.basis,
        manualValues,
      }),
    [ingredients, form.totalYield, form.portionSize, form.basis, manualValues],
  )

  const unit = form.basis === 'liquido' ? 'mL' : 'g'
  const perColumn = form.basis === 'liquido' ? '100 mL' : '100 g'
  const portionExceeds = form.portionSize > form.totalYield

  function addIngredient(food: FoodDTO) {
    const grams = food.measures.find((m) => m.isDefault)?.grams ?? food.referenceGrams
    setIngredients((v) => [
      ...v,
      {
        key: nextKey(),
        foodId: food.id,
        name: food.name,
        grams,
        food: {
          referenceGrams: food.referenceGrams,
          energyKcal: food.energyKcal,
          proteinG: food.proteinG,
          carbG: food.carbG,
          fatG: food.fatG,
          fiberG: food.fiberG,
          micros: food.micronutrients ?? null,
        },
      },
    ])
  }

  function reset() {
    setLabelId(null)
    setForm({ ...EMPTY_FORM })
    setIngredients([])
    setManualValues({})
    setMsg(null)
  }

  async function openLabel(id: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/rotulos/${id}`)
      if (!res.ok) {
        setMsg('Não foi possível abrir o rótulo.')
        return
      }
      const data = (await res.json()) as {
        label: {
          id: string
          productName: string
          clientName: string | null
          basis: LabelBasis
          totalYield: number
          portionSize: number
          householdMeasure: string | null
          portionsPerPackage: number | null
          ingredientsText: string | null
          allergensText: string | null
          storageText: string | null
          manualValues: Record<string, number>
          ingredients: {
            foodId: string
            name: string
            grams: number
            food: {
              referenceGrams: number
              energyKcal: number
              proteinG: number
              carbG: number
              fatG: number
              fiberG: number | null
              micros: Record<string, number> | null
            }
          }[]
        }
      }
      const l = data.label
      setLabelId(l.id)
      setForm({
        productName: l.productName,
        clientName: l.clientName ?? '',
        basis: l.basis,
        totalYield: l.totalYield,
        portionSize: l.portionSize,
        householdMeasure: l.householdMeasure ?? '',
        portionsPerPackage: l.portionsPerPackage === null ? '' : String(l.portionsPerPackage),
        ingredientsText: l.ingredientsText ?? '',
        allergensText: l.allergensText ?? '',
        storageText: l.storageText ?? '',
      })
      setManualValues(l.manualValues ?? {})
      // Os nutrientes dos ingredientes vêm no próprio GET — a tabela ao vivo
      // recompõe sem uma busca por ingrediente.
      setIngredients(
        l.ingredients.map((ing) => ({
          key: nextKey(),
          foodId: ing.foodId,
          name: ing.name,
          grams: ing.grams,
          food: {
            referenceGrams: ing.food.referenceGrams,
            energyKcal: ing.food.energyKcal,
            proteinG: ing.food.proteinG,
            carbG: ing.food.carbG,
            fatG: ing.food.fatG,
            fiberG: ing.food.fiberG,
            micros: ing.food.micros ?? null,
          },
        })),
      )
      setMsg(null)
    } finally {
      setLoading(false)
    }
  }

  function body() {
    return {
      productName: form.productName.trim(),
      clientName: form.clientName.trim() || null,
      basis: form.basis,
      totalYield: form.totalYield,
      portionSize: form.portionSize,
      householdMeasure: form.householdMeasure.trim() || null,
      portionsPerPackage: form.portionsPerPackage ? Number(form.portionsPerPackage) : null,
      ingredientsText: form.ingredientsText.trim() || null,
      allergensText: form.allergensText.trim() || null,
      storageText: form.storageText.trim() || null,
      ingredients: ingredients.map((i, idx) => ({
        foodId: i.foodId,
        grams: i.grams,
        position: idx,
      })),
    }
  }

  async function save() {
    if (!form.productName.trim() || ingredients.length === 0) {
      setMsg('Informe o nome do produto e ao menos um ingrediente.')
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const payload = labelId ? { ...body(), manualValues } : body()
      const res = await fetch(labelId ? `/api/rotulos/${labelId}` : '/api/rotulos', {
        method: labelId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { code?: string } } | null
        setMsg(
          err?.error?.code === 'PORTION_EXCEEDS_YIELD'
            ? 'A porção não pode ser maior que o rendimento.'
            : 'Falha ao salvar o rótulo.',
        )
        return
      }
      if (!labelId) {
        const created = (await res.json()) as { id: string }
        setLabelId(created.id)
        // As sobrescritas feitas antes de salvar não vão no POST — persisto na
        // sequência para que nada informado à mão se perca no primeiro save.
        if (Object.keys(manualValues).length > 0) {
          await fetch(`/api/rotulos/${created.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ manualValues }),
          })
        }
      }
      setMsg('Rótulo salvo.')
      await loadList()
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/rotulos/${id}`, { method: 'DELETE' })
    if (res.ok) {
      if (id === labelId) reset()
      await loadList()
    }
  }

  function duplicate() {
    // Duplicar = soltar o vínculo com o registro salvo. O próximo save cria um
    // novo rótulo com a composição atual.
    setLabelId(null)
    set('productName', `${form.productName} (cópia)`)
    setMsg('Cópia em edição. Salve para criar o novo rótulo.')
  }

  function startEdit(row: LabelNutrientRow) {
    setEditingKey(row.key)
    setEditingValue(row.per100 === null ? '' : String(row.per100))
  }
  function commitEdit(key: string) {
    const v = Number(editingValue.replace(',', '.'))
    if (Number.isFinite(v) && v >= 0) setManualValues((m) => ({ ...m, [key]: v }))
    setEditingKey(null)
    setEditingValue('')
  }
  function undoOverride(key: string) {
    setManualValues((m) => {
      const out = { ...m }
      delete out[key]
      return out
    })
  }

  const applied = (
    Object.entries(result.frontOfPack) as Array<[FrontOfPackNutrient, string]>
  ).filter(([, v]) => v === 'aplica')
  const inconclusive = (
    Object.entries(result.frontOfPack) as Array<[FrontOfPackNutrient, string]>
  ).filter(([, v]) => v === 'inconclusivo')

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Produto</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="rl_name">Nome do produto</Label>
              <Input
                id="rl_name"
                value={form.productName}
                onChange={(e) => set('productName', e.target.value)}
                placeholder="Bolo de cenoura com cobertura"
              />
            </div>
            <div>
              <Label htmlFor="rl_client">Cliente</Label>
              <Input
                id="rl_client"
                value={form.clientName}
                onChange={(e) => set('clientName', e.target.value)}
                placeholder="Confeitaria da Ana"
              />
            </div>
            <div>
              <Label htmlFor="rl_basis">Base de declaração</Label>
              <select
                id="rl_basis"
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={form.basis}
                onChange={(e) => set('basis', e.target.value as LabelBasis)}
              >
                <option value="solido">Sólido (por 100 g)</option>
                <option value="liquido">Líquido (por 100 mL)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rl_yield">Rendimento ({unit})</Label>
                <Input
                  id="rl_yield"
                  type="number"
                  min={1}
                  value={form.totalYield}
                  onChange={(e) => set('totalYield', Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="rl_portion">Porção ({unit})</Label>
                <Input
                  id="rl_portion"
                  type="number"
                  min={1}
                  value={form.portionSize}
                  onChange={(e) => set('portionSize', Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="rl_measure">Medida caseira</Label>
              <Input
                id="rl_measure"
                value={form.householdMeasure}
                onChange={(e) => set('householdMeasure', e.target.value)}
                placeholder="1 fatia"
              />
            </div>
            <div>
              <Label htmlFor="rl_ppp">Porções por embalagem</Label>
              <Input
                id="rl_ppp"
                type="number"
                min={1}
                value={form.portionsPerPackage}
                onChange={(e) => set('portionsPerPackage', e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {portionExceeds ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
            A porção ({formatDeclared(form.portionSize)} {unit}) está maior que o rendimento (
            {formatDeclared(form.totalYield)} {unit}). Ajuste antes de salvar.
          </p>
        ) : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Ingredientes do preparo
              <span className="ml-2 font-normal text-slate-400">
                soma {formatDeclared(ingredients.reduce((s, i) => s + i.grams, 0))} {unit} ·
                rendimento informado {formatDeclared(form.totalYield)} {unit}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ingredients.map((ing) => (
              <div key={ing.key} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm">{ing.name}</span>
                <Input
                  className="h-8 w-24"
                  type="number"
                  min={1}
                  value={ing.grams}
                  onChange={(e) =>
                    setIngredients((v) =>
                      v.map((i) =>
                        i.key === ing.key ? { ...i, grams: Number(e.target.value) } : i,
                      ),
                    )
                  }
                />
                <span className="text-xs text-slate-400">g</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIngredients((v) => v.filter((i) => i.key !== ing.key))}
                >
                  <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                </Button>
              </div>
            ))}
            <FoodSearch onPick={addIngredient} />
            {ingredients.length === 0 ? (
              <p className="text-xs text-slate-400">
                Adicione os ingredientes com as quantidades da receita. O rendimento é informado
                separadamente, porque a perda por cocção é real e não pode ser deduzida da soma.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Informações da embalagem</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div>
              <Label htmlFor="rl_ing_text">Lista de ingredientes (texto do rótulo)</Label>
              <textarea
                id="rl_ing_text"
                className="min-h-[60px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                value={form.ingredientsText}
                onChange={(e) => set('ingredientsText', e.target.value)}
                placeholder="Farinha de trigo, cenoura, ovos, açúcar…"
              />
            </div>
            <div>
              <Label htmlFor="rl_allerg">Alérgicos</Label>
              <Input
                id="rl_allerg"
                value={form.allergensText}
                onChange={(e) => set('allergensText', e.target.value)}
                placeholder="ALÉRGICOS: CONTÉM TRIGO, OVOS E LEITE."
              />
            </div>
            <div>
              <Label htmlFor="rl_storage">Conservação</Label>
              <Input
                id="rl_storage"
                value={form.storageText}
                onChange={(e) => set('storageText', e.target.value)}
                placeholder="Conservar em local seco e arejado."
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">INFORMAÇÃO NUTRICIONAL</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.incomplete ? (
              <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <p className="text-xs text-red-700">
                  Rótulo incompleto, não utilizável em embalagem. Informe os valores das linhas
                  marcadas.
                </p>
              </div>
            ) : null}

            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-300 text-slate-500">
                  <th className="py-1 text-left font-medium">&nbsp;</th>
                  <th className="py-1 text-right font-medium">{perColumn}</th>
                  <th className="py-1 text-right font-medium">
                    {formatDeclared(form.portionSize)} {unit}
                  </th>
                  <th className="py-1 text-right font-medium">%VD</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr
                    key={row.key}
                    className={
                      row.state === 'incompleto'
                        ? 'border-b border-slate-100 bg-red-50/60'
                        : row.state === 'sobrescrito'
                          ? 'border-b border-slate-100 bg-accent/60'
                          : 'border-b border-slate-100'
                    }
                  >
                    <td className="py-1">
                      <div className="flex items-center gap-1">
                        <span>{row.label}</span>
                        {row.state === 'sobrescrito' ? (
                          <button
                            type="button"
                            title="Desfazer valor informado"
                            onClick={() => undoOverride(row.key)}
                            className="text-link hover:text-info-text"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Informar valor manualmente"
                            onClick={() => startEdit(row)}
                            className="text-slate-300 hover:text-slate-600"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {row.state === 'incompleto' && row.missingFrom.length > 0 ? (
                        <p className="text-[10px] leading-tight text-red-600">
                          sem dado em: {row.missingFrom.join(', ')}
                        </p>
                      ) : null}
                      {row.state === 'sobrescrito' ? (
                        <p className="text-[10px] leading-tight text-link">informado à mão</p>
                      ) : null}
                    </td>
                    {editingKey === row.key ? (
                      <td colSpan={3} className="py-1">
                        <div className="flex items-center gap-1">
                          <Input
                            autoFocus
                            className="h-7 text-xs"
                            value={editingValue}
                            placeholder={`por ${perColumn}`}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit(row.key)
                              if (e.key === 'Escape') setEditingKey(null)
                            }}
                          />
                          <Button size="sm" className="h-7" onClick={() => commitEdit(row.key)}>
                            OK
                          </Button>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="py-1 text-right tabular-nums">
                          {row.per100 === null ? (
                            <span className="text-red-500">sem dado</span>
                          ) : (
                            `${formatDeclared(row.per100)} ${row.unit === 'kcal' ? 'kcal' : row.unit}`
                          )}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {row.perPortion === null
                            ? '-'
                            : `${formatDeclared(row.perPortion)} ${row.unit === 'kcal' ? 'kcal' : row.unit}`}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {row.dvPercent === null ? '-' : `${formatDeclared(row.dvPercent)}%`}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {applied.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {applied.map(([key]) => (
                  <span
                    key={key}
                    className="rounded border-2 border-slate-900 px-2 py-1 text-[10px] font-bold"
                  >
                    {FRONT_OF_PACK_LABEL[key]}
                  </span>
                ))}
              </div>
            ) : null}
            {inconclusive.length > 0 ? (
              <p className="text-[11px] text-amber-700">
                Falta dado para concluir sobre a lupa em:{' '}
                {inconclusive
                  .map(([key]) => FRONT_OF_PACK_LABEL[key].replace('ALTO EM ', '').toLowerCase())
                  .join(', ')}
                . Isto não quer dizer que a marca frontal seja dispensada.
              </p>
            ) : null}

            <p className="text-[10px] text-slate-400">
              Referência: {result.normativeVersion}. A responsabilidade técnica pelo rótulo e pela
              conferência dos dados é do profissional responsável.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={saving || portionExceeds} size="sm">
                {saving ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1 h-3.5 w-3.5" />
                )}
                Salvar
              </Button>
              {labelId ? (
                <>
                  <Button variant="outline" size="sm" onClick={duplicate}>
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    Duplicar
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/rotulos/${labelId}/pdf`} target="_blank" rel="noreferrer">
                      <FileDown className="mr-1 h-3.5 w-3.5" />
                      Exportar
                    </a>
                  </Button>
                </>
              ) : null}
              <Button variant="ghost" size="sm" onClick={reset}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Novo
              </Button>
            </div>
            {msg ? <p className="text-xs text-slate-500">{msg}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Rótulos salvos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
            {labels.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum rótulo salvo ainda.</p>
            ) : null}
            {labels.map((l) => (
              <div
                key={l.id}
                className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                  l.id === labelId ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  className="flex-1 truncate text-left"
                  onClick={() => void openLabel(l.id)}
                >
                  <span className="font-medium">{l.productName}</span>
                  {l.clientName ? <span className="text-slate-400"> · {l.clientName}</span> : null}
                  {l.incomplete ? (
                    <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">
                      incompleto
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(l.id)}
                  className="text-slate-300 hover:text-red-500"
                  title="Remover"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
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
          placeholder="Adicionar ingrediente…"
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
