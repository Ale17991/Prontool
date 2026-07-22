'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Repeat2, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FoodDTO } from '@/lib/core/nutrition/foods/search'
import type { EquivalenceListDTO } from '@/lib/core/nutrition/foods/equivalence'

interface GroupOption {
  slug: string
  label: string
}
interface DraftItem {
  key: string
  foodId: string
  name: string
  grams: number
}

let seq = 0
const key = () => `e${++seq}`

export function EquivalenceListsClient({ groups }: { groups: GroupOption[] }) {
  const [lists, setLists] = useState<EquivalenceListDTO[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    const res = await fetch('/api/alimentos/grupos')
    if (res.ok) setLists(((await res.json()) as { equivalenceLists: EquivalenceListDTO[] }).equivalenceLists)
    setLoading(false)
  }
  useEffect(() => {
    void refresh()
  }, [])

  const groupLabel = new Map(groups.map((g) => [g.slug, g.label]))

  async function remove(id: string) {
    const res = await fetch(`/api/alimentos/grupos/${id}`, { method: 'DELETE' })
    if (res.ok) setLists((v) => v.filter((l) => l.id !== id))
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Repeat2 className="h-4 w-4 text-primary" /> Listas de substituição
        </CardTitle>
        <Button
          size="sm"
          variant={showForm ? 'outline' : 'default'}
          onClick={() => setShowForm((v) => !v)}
          className="gap-1.5"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? 'Cancelar' : 'Nova lista'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-slate-400">
          Alimentos equivalentes dentro de um grupo — as opções &quot;ou&quot; que o paciente pode
          trocar no plano.
        </p>

        {showForm ? (
          <NewListForm
            groups={groups}
            onCreated={async () => {
              setShowForm(false)
              await refresh()
            }}
          />
        ) : null}

        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : lists.length === 0 ? (
          <p className="text-xs text-slate-400">Nenhuma lista de substituição ainda.</p>
        ) : (
          <ul className="space-y-2">
            {lists.map((l) => (
              <li key={l.id} className="rounded-md border border-slate-200 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">
                    {l.name}
                    <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                      {l.groupSlug ? groupLabel.get(l.groupSlug) ?? l.groupSlug : ''}
                      {l.referenceKcal ? ` · ≈${l.referenceKcal} kcal` : ''}
                      {l.isCustom ? '' : ' · padrão'}
                    </span>
                  </span>
                  {l.isCustom ? (
                    <button
                      type="button"
                      onClick={() => remove(l.id)}
                      className="text-slate-400 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {l.items.map((i) => `${i.name} ${i.grams}g`).join(' · ') || '—'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function NewListForm({ groups, onCreated }: { groups: GroupOption[]; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [groupSlug, setGroupSlug] = useState(groups[0]?.slug ?? '')
  const [refKcal, setRefKcal] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (!name.trim()) return setError('Informe o nome da lista.')
    if (items.length === 0) return setError('Adicione ao menos um alimento.')
    setPending(true)
    try {
      const res = await fetch('/api/alimentos/grupos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          group_slug: groupSlug,
          name: name.trim(),
          reference_kcal: refKcal.trim() ? Number(refKcal.replace(',', '.')) : null,
          items: items.map((i) => ({ food_id: i.foodId, grams: i.grams })),
        }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao criar a lista.')
        return
      }
      onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/50 p-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="col-span-2">
          <Label htmlFor="el_name">Nome</Label>
          <Input id="el_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Carboidratos — 1 porção" />
        </div>
        <div>
          <Label htmlFor="el_group">Grupo</Label>
          <select
            id="el_group"
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={groupSlug}
            onChange={(e) => setGroupSlug(e.target.value)}
          >
            {groups.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="el_kcal">≈ kcal (opc.)</Label>
          <Input id="el_kcal" inputMode="decimal" value={refKcal} onChange={(e) => setRefKcal(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.key} className="flex items-center gap-2 text-sm">
            <span className="flex-1 truncate">{it.name}</span>
            <Input
              className="h-8 w-20 text-right"
              inputMode="decimal"
              value={String(it.grams)}
              onChange={(e) =>
                setItems((v) =>
                  v.map((x) => (x.key === it.key ? { ...x, grams: Number(e.target.value.replace(',', '.')) || 0 } : x)),
                )
              }
            />
            <span className="text-xs text-slate-400">g</span>
            <button
              type="button"
              onClick={() => setItems((v) => v.filter((x) => x.key !== it.key))}
              className="text-slate-300 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <FoodPicker
          onPick={(f) =>
            setItems((v) => [
              ...v,
              { key: key(), foodId: f.id, name: f.name, grams: f.measures.find((m) => m.isDefault)?.grams ?? f.referenceGrams },
            ])
          }
        />
      </div>

      {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={pending} className="gap-1.5">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Criar lista
        </Button>
      </div>
    </div>
  )
}

function FoodPicker({ onPick }: { onPick: (f: FoodDTO) => void }) {
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
          placeholder="Adicionar alimento à lista…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && results.length > 0 ? (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
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
              <span className="ml-2 shrink-0 text-[10px] text-slate-400">{f.energyKcal} kcal</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
