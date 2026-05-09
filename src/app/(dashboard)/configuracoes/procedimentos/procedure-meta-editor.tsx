'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'

interface Props {
  procedureId: string
  defaultAmountCents: number | null
  coveredByPlan: boolean
}

/**
 * Inline editor para `default_amount_cents` e `covered_by_plan` de um
 * procedimento. Em modo de leitura renderiza um par de badges compactos;
 * em modo de edição, inputs + save/cancel. PATCH em /api/procedimentos/[id].
 */
export function ProcedureMetaEditor({
  procedureId,
  defaultAmountCents,
  coveredByPlan,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(
    defaultAmountCents !== null ? (defaultAmountCents / 100).toFixed(2).replace('.', ',') : '',
  )
  const [covered, setCovered] = useState(coveredByPlan)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    let amountCents: number | null = null
    const trimmed = amount.trim().replace(',', '.')
    if (trimmed.length > 0) {
      const parsed = Number(trimmed)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('Valor inválido')
        return
      }
      amountCents = Math.round(parsed * 100)
    }

    const res = await fetch(`/api/procedimentos/${procedureId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        default_amount_cents: amountCents,
        covered_by_plan: covered,
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      setError(body.error?.message ?? 'Falha ao salvar')
      return
    }
    setEditing(false)
    startTransition(() => router.refresh())
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <Badge
          variant={coveredByPlan ? 'secondary' : 'outline'}
          className={coveredByPlan ? '' : 'border-amber-300 text-amber-700'}
        >
          {coveredByPlan ? 'Coberto por planos' : 'Particular'}
        </Badge>
        <span className="text-[11px] text-slate-500">
          Part.:{' '}
          <span className="font-bold tabular-nums text-slate-700">
            {defaultAmountCents !== null ? formatCurrency(defaultAmountCents) : '—'}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700"
          title="Editar valor particular e cobertura"
        >
          <Pencil className="h-3 w-3" /> Editar
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 md:flex-row md:items-center">
      <label className="flex items-center gap-1 text-[11px] text-slate-600">
        <input
          type="checkbox"
          checked={covered}
          onChange={(e) => setCovered(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        Coberto
      </label>
      <Input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        placeholder="R$ particular"
        className="h-7 w-28 text-xs"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2 text-[10px] font-bold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Salvar
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false)
            setAmount(
              defaultAmountCents !== null
                ? (defaultAmountCents / 100).toFixed(2).replace('.', ',')
                : '',
            )
            setCovered(coveredByPlan)
            setError(null)
          }}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {error ? <p className="text-[10px] font-semibold text-rose-700">{error}</p> : null}
    </div>
  )
}
