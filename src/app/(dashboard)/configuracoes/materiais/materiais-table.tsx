'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { parseReaisToCents, centsToReais } from '@/components/atendimentos/materiais-editor'

export interface MaterialListItem {
  id: string
  name: string
  unit_cost_cents: number
  tuss_code: string | null
  active: boolean
}

export function MateriaisTable({ initialItems }: { initialItems: MaterialListItem[] }) {
  const router = useRouter()
  const [items, setItems] = useState<MaterialListItem[]>(initialItems)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // form de criação
  const [newName, setNewName] = useState('')
  const [newCost, setNewCost] = useState('')

  // edição inline
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCost, setEditCost] = useState('')

  async function create() {
    setError(null)
    const name = newName.trim()
    if (!name) {
      setError('Informe o nome do insumo.')
      return
    }
    const cost = parseReaisToCents(newCost) ?? 0
    setBusy(true)
    try {
      const res = await fetch('/api/materiais', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, unit_cost_cents: cost }),
      })
      const body = (await res.json().catch(() => null)) as
        | (MaterialListItem & { error?: { message?: string } })
        | null
      if (!res.ok) {
        setError(body?.error?.message ?? 'Não foi possível criar o insumo.')
        return
      }
      if (body) setItems((prev) => [...prev, body as MaterialListItem])
      setNewName('')
      setNewCost('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function startEdit(item: MaterialListItem) {
    setEditingId(item.id)
    setEditName(item.name)
    setEditCost(item.unit_cost_cents > 0 ? centsToReais(item.unit_cost_cents) : '')
    setError(null)
  }

  async function patch(id: string, payload: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/materiais/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => null)) as
        | (MaterialListItem & { error?: { message?: string } })
        | null
      if (!res.ok) {
        setError(body?.error?.message ?? 'Não foi possível salvar.')
        return false
      }
      if (body) {
        setItems((prev) => prev.map((it) => (it.id === id ? (body as MaterialListItem) : it)))
      }
      router.refresh()
      return true
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(id: string) {
    const name = editName.trim()
    if (!name) {
      setError('Informe o nome do insumo.')
      return
    }
    const cost = parseReaisToCents(editCost)
    if (editCost.trim() && cost === null) {
      setError('Custo inválido.')
      return
    }
    const ok = await patch(id, { name, unit_cost_cents: cost ?? 0 })
    if (ok) setEditingId(null)
  }

  return (
    <div className="space-y-4">
      {/* criar */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">
              Novo insumo
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ex.: Anestésico, luva, resina…"
              disabled={busy}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase text-slate-500">
              Custo un. (R$)
            </label>
            <Input
              value={newCost}
              onChange={(e) => setNewCost(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className="w-28 text-right tabular-nums"
              disabled={busy}
            />
          </div>
          <Button type="button" onClick={() => void create()} disabled={busy} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* lista */}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              Nenhum insumo cadastrado ainda.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-semibold">Insumo</th>
                  <th className="px-4 py-2 text-right font-semibold">Custo un.</th>
                  <th className="px-4 py-2 text-center font-semibold">Situação</th>
                  <th className="px-4 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const editing = editingId === it.id
                  return (
                    <tr key={it.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2">
                        {editing ? (
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            disabled={busy}
                            className="h-8"
                          />
                        ) : (
                          <span className={it.active ? 'text-slate-800' : 'text-slate-400'}>
                            {it.name}
                            {it.tuss_code ? (
                              <span className="ml-2 font-mono text-[11px] text-slate-400">
                                {it.tuss_code}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {editing ? (
                          <Input
                            value={editCost}
                            onChange={(e) => setEditCost(e.target.value)}
                            inputMode="decimal"
                            placeholder="0,00"
                            disabled={busy}
                            className="h-8 w-24 text-right tabular-nums"
                          />
                        ) : (
                          <span className={it.active ? 'text-slate-700' : 'text-slate-400'}>
                            {formatCurrency(it.unit_cost_cents)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {it.active ? (
                          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                            ativo
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                            inativo
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {editing ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => void saveEdit(it.id)}
                                disabled={busy}
                                className="h-8 w-8 p-0 text-teal-600"
                                title="Salvar"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingId(null)}
                                disabled={busy}
                                className="h-8 w-8 p-0 text-slate-400"
                                title="Cancelar"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => startEdit(it)}
                                disabled={busy}
                                className="h-8 w-8 p-0 text-slate-500"
                                title="Editar"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void patch(it.id, { active: !it.active })}
                                disabled={busy}
                                className="h-8 px-2 text-xs"
                              >
                                {it.active ? 'Desativar' : 'Reativar'}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
