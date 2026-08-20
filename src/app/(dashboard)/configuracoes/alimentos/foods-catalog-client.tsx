'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Apple, Loader2, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { energyFromMacros } from '@/lib/core/nutrition/foods/atwater'
import { MICRONUTRIENTS_PRIMARY, micronutrientDef } from '@/lib/core/nutrition/micronutrients'
import type { FoodDTO } from '@/lib/core/nutrition/foods/search'

interface GroupOption {
  slug: string
  label: string
}

function num(s: string): number | undefined {
  if (s.trim() === '') return undefined
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export function FoodsCatalogClient({ groups }: { groups: GroupOption[] }) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'all' | 'custom'>('all')
  const [results, setResults] = useState<FoodDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    const t = setTimeout(async () => {
      if (query.trim().length < 2 && scope === 'all') {
        setResults([])
        return
      }
      setLoading(true)
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      params.set('scope', scope)
      const res = await fetch(`/api/alimentos?${params}`)
      if (res.ok) setResults(((await res.json()) as { foods: FoodDTO[] }).foods)
      setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query, scope])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            className="pl-8"
            placeholder="Buscar alimento (ex.: arroz, frango, açúcar)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'all' | 'custom')}
        >
          <option value="all">Todo o catálogo</option>
          <option value="custom">Só da clínica</option>
        </select>
        <Button
          size="sm"
          variant={showForm ? 'outline' : 'default'}
          onClick={() => setShowForm((v) => !v)}
          className="gap-1.5"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? 'Cancelar' : 'Novo alimento'}
        </Button>
      </div>

      {showForm ? (
        <NewFoodForm
          groups={groups}
          onCreated={() => {
            setShowForm(false)
            setScope('custom')
            setQuery('')
          }}
        />
      ) : null}

      <div className="overflow-hidden rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Alimento</th>
              <th className="px-3 py-2 text-left">Fonte</th>
              <th className="px-3 py-2 text-right">kcal</th>
              <th className="px-3 py-2 text-right">P / C / G (g)</th>
              <th className="px-3 py-2 text-left">Medidas</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            ) : results.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">
                  {query.trim().length < 2 && scope === 'all'
                    ? 'Digite ao menos 2 letras para buscar.'
                    : 'Nenhum alimento encontrado.'}
                </td>
              </tr>
            ) : (
              results.map((f) => (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-800">{f.name}</span>
                    <span className="ml-1 text-[10px] text-slate-400">
                      /{f.referenceGrams} g{f.groupLabel ? ` · ${f.groupLabel}` : ''}
                    </span>
                    {f.micronutrients ? (
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {MICRONUTRIENTS_PRIMARY.filter((k) => f.micronutrients![k] !== undefined)
                          .map((k) => {
                            const d = micronutrientDef(k)
                            return `${d?.label ?? k} ${Math.round(f.micronutrients![k]! * 10) / 10}${d?.unit ?? ''}`
                          })
                          .join(' · ') || '—'}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <SourceBadge source={f.source} isCustom={f.isCustom} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.energyKcal}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {f.proteinG} / {f.carbG} / {f.fatG}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-500">
                    {f.measures.length > 0
                      ? f.measures.map((m) => `${m.label} ${m.grams}g`).join(' · ')
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SourceBadge({ source, isCustom }: { source: string; isCustom: boolean }) {
  const label = isCustom
    ? 'Clínica'
    : source === 'taco'
      ? 'TACO'
      : source === 'ibge_pof'
        ? 'IBGE/POF'
        : source
  const cls = isCustom
    ? 'bg-primary/10 text-primary'
    : source === 'taco'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-slate-100 text-slate-600'
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>
}

function NewFoodForm({ groups, onCreated }: { groups: GroupOption[]; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [groupSlug, setGroupSlug] = useState('')
  const [refGrams, setRefGrams] = useState('100')
  const [energy, setEnergy] = useState('')
  const [prot, setProt] = useState('')
  const [carb, setCarb] = useState('')
  const [fat, setFat] = useState('')
  const [fiber, setFiber] = useState('')
  const [measureLabel, setMeasureLabel] = useState('')
  const [measureGrams, setMeasureGrams] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const derivedEnergy = useMemo(() => {
    if (energy.trim() !== '') return null
    const p = num(prot)
    const c = num(carb)
    const f = num(fat)
    if (p === undefined || c === undefined || f === undefined) return null
    return energyFromMacros(p, c, f)
  }, [energy, prot, carb, fat])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const p = num(prot)
    const c = num(carb)
    const f = num(fat)
    const rg = num(refGrams)
    if (!name.trim()) return setError('Informe o nome do alimento.')
    if (rg === undefined || rg <= 0) return setError('Informe a porção de referência.')
    if (p === undefined || c === undefined || f === undefined)
      return setError('Informe os macros (P/C/G).')

    setPending(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        group_slug: groupSlug || null,
        reference_grams: rg,
        energy_kcal: num(energy) ?? null,
        protein_g: p,
        carb_g: c,
        fat_g: f,
        fiber_g: num(fiber) ?? null,
      }
      const ml = measureLabel.trim()
      const mg = num(measureGrams)
      if (ml && mg !== undefined && mg > 0) {
        body.measures = [{ label: ml, grams: mg, is_default: true }]
      }
      const res = await fetch('/api/alimentos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao cadastrar o alimento.')
        return
      }
      onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Apple className="h-4 w-4 text-primary" /> Novo alimento da clínica
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2 md:col-span-2">
            <Label htmlFor="f_name">Nome</Label>
            <Input id="f_name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="f_group">Grupo</Label>
            <select
              id="f_group"
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={groupSlug}
              onChange={(e) => setGroupSlug(e.target.value)}
            >
              <option value="">—</option>
              {groups.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="f_ref">Porção ref. (g)</Label>
            <Input
              id="f_ref"
              inputMode="decimal"
              value={refGrams}
              onChange={(e) => setRefGrams(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="f_prot">Proteína (g)</Label>
            <Input
              id="f_prot"
              inputMode="decimal"
              value={prot}
              onChange={(e) => setProt(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="f_carb">Carboidrato (g)</Label>
            <Input
              id="f_carb"
              inputMode="decimal"
              value={carb}
              onChange={(e) => setCarb(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="f_fat">Lipídio (g)</Label>
            <Input
              id="f_fat"
              inputMode="decimal"
              value={fat}
              onChange={(e) => setFat(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="f_energy">
              Energia (kcal){' '}
              {derivedEnergy !== null ? (
                <span className="text-[10px] text-slate-400">
                  ≈ {Math.round(derivedEnergy * 100) / 100}
                </span>
              ) : null}
            </Label>
            <Input
              id="f_energy"
              inputMode="decimal"
              placeholder="auto (Atwater)"
              value={energy}
              onChange={(e) => setEnergy(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="f_fiber">Fibra (g)</Label>
            <Input
              id="f_fiber"
              inputMode="decimal"
              value={fiber}
              onChange={(e) => setFiber(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="f_ml">Medida caseira</Label>
            <Input
              id="f_ml"
              placeholder="ex.: scoop"
              value={measureLabel}
              onChange={(e) => setMeasureLabel(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="f_mg">Medida (g)</Label>
            <Input
              id="f_mg"
              inputMode="decimal"
              value={measureGrams}
              onChange={(e) => setMeasureGrams(e.target.value)}
            />
          </div>

          {error ? (
            <p className="col-span-2 md:col-span-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
              {error}
            </p>
          ) : null}
          <div className="col-span-2 md:col-span-4 flex justify-end">
            <Button type="submit" size="sm" disabled={pending} className="gap-2">
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Cadastrar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
