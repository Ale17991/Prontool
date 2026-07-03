'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ProcedureOption {
  id: string
  tussCode: string | null
  displayName: string | null
}

function centsToReais(cents: number | null): string {
  if (cents === null) return ''
  return (cents / 100).toFixed(2).replace('.', ',')
}

function reaisToCents(reais: string): number | null {
  const n = Number(reais.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/**
 * Adiciona um novo procedimento ao atendimento existente. Plano = o do
 * atendimento (passado via `planId`; null = particular). Preço sugerido
 * automaticamente e editável. Self-contained: carrega procedimentos e chama
 * `onAdded` (refetch) após inserir.
 */
export function AddProcedureSection({
  appointmentId,
  planId,
  onAdded,
}: {
  appointmentId: string
  planId: string | null
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ProcedureOption[]>([])
  const [procedureId, setProcedureId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [amount, setAmount] = useState('')
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || options.length > 0) return
    void (async () => {
      const res = await fetch('/api/procedimentos', { cache: 'no-store' })
      if (res.ok) {
        const list = (await res.json()) as Array<{
          id: string
          tussCode: string | null
          displayName: string | null
          defaultAmountCents: number | null
        }>
        setOptions(
          list.map((p) => ({ id: p.id, tussCode: p.tussCode, displayName: p.displayName })),
        )
      }
    })()
  }, [open, options.length])

  // Sugere o valor ao escolher o procedimento.
  async function onPick(id: string) {
    setProcedureId(id)
    setError(null)
    if (!id) {
      setAmount('')
      return
    }
    setLoadingPrice(true)
    try {
      if (planId) {
        const res = await fetch(`/api/precos/vigente?procedure_id=${id}&plan_id=${planId}`, {
          cache: 'no-store',
        })
        if (res.ok) {
          const b = (await res.json()) as { amountCents: number | null }
          setAmount(centsToReais(b.amountCents))
        } else {
          setAmount('')
        }
      } else {
        // Particular — usa o valor padrão do procedimento.
        const res = await fetch('/api/procedimentos', { cache: 'no-store' })
        if (res.ok) {
          const list = (await res.json()) as Array<{
            id: string
            defaultAmountCents: number | null
          }>
          const found = list.find((p) => p.id === id)
          setAmount(centsToReais(found?.defaultAmountCents ?? null))
        }
      }
    } finally {
      setLoadingPrice(false)
    }
  }

  async function add() {
    setError(null)
    if (!procedureId) {
      setError('Selecione um procedimento.')
      return
    }
    const cents = amount.trim() ? reaisToCents(amount) : null
    if (amount.trim() && cents === null) {
      setError('Valor inválido.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/atendimentos/${appointmentId}/procedimentos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          procedure_id: procedureId,
          quantity,
          amount_cents_override: cents,
        }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao adicionar.')
        return
      }
      setProcedureId('')
      setAmount('')
      setQuantity(1)
      setOpen(false)
      onAdded()
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" /> Adicionar procedimento
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <div>
        <Label className="text-[11px] font-bold uppercase text-slate-500">Procedimento</Label>
        <select
          value={procedureId}
          onChange={(e) => void onPick(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
        >
          <option value="">Selecione…</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {[p.tussCode, p.displayName].filter(Boolean).join(' · ') || p.id}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">
            Valor unit. (R$){planId ? '' : ' · particular'}
          </Label>
          <div className="relative">
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className="w-32"
            />
            {loadingPrice ? (
              <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-slate-400" />
            ) : null}
          </div>
        </div>
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">Qtd</Label>
          <Input
            type="number"
            min={1}
            max={99}
            value={quantity}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value))
              if (Number.isFinite(n)) setQuantity(Math.min(99, Math.max(1, n)))
            }}
            className="w-20"
          />
        </div>
      </div>
      {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={add} disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Adicionar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={pending}
        >
          Cancelar
        </Button>
      </div>
    </div>
  )
}
