'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface ProcedureOption {
  id: string
  tuss_code: string
  display_name: string | null
}

interface PlanOption {
  id: string
  name: string
}

export function NewPriceForm({
  procedures,
  plans,
}: {
  procedures: ProcedureOption[]
  plans: PlanOption[]
}) {
  const router = useRouter()
  const [procedureId, setProcedureId] = useState(procedures[0]?.id ?? '')
  const [planId, setPlanId] = useState(plans[0]?.id ?? '')
  const [amountStr, setAmountStr] = useState('')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const amountCents = toCents(amountStr)
    if (amountCents === null) {
      setError('Informe um valor válido (ex.: 250,00).')
      return
    }
    setPending(true)
    try {
      const res = await fetch('/api/precos/versions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          procedure_id: procedureId,
          plan_id: planId,
          amount_cents: amountCents,
          valid_from: validFrom,
          reason,
          expected_head_id: null,
        }),
      })
      if (res.status === 409) {
        const payload = (await res.json().catch(() => ({}))) as {
          current_head_id?: string | null
        }
        const headId = payload.current_head_id
        setError(
          headId
            ? `Já existe um preço para essa combinação. Abra o preço atual para editá-lo.`
            : 'Conflito de concorrência. Recarregue e tente de novo.',
        )
        if (headId) router.push(`/precos/${headId}`)
        return
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
          message?: string
        }
        throw new Error(payload.error?.message ?? payload.message ?? `HTTP ${res.status}`)
      }
      const created = (await res.json()) as { id: string }
      router.push(`/precos/${created.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="procedure" className="text-xs">
          Procedimento
        </Label>
        <select
          id="procedure"
          required
          value={procedureId}
          onChange={(e) => setProcedureId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {procedures.map((p) => (
            <option key={p.id} value={p.id}>
              {p.tuss_code} — {p.display_name ?? ''}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="plan" className="text-xs">
          Convênio
        </Label>
        <select
          id="plan"
          required
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="amount" className="text-xs">
            Valor (R$)
          </Label>
          <Input
            id="amount"
            required
            inputMode="decimal"
            placeholder="250,00"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="valid_from" className="text-xs">
            Vigência a partir de
          </Label>
          <Input
            id="valid_from"
            required
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reason" className="text-xs">
          Motivo
        </Label>
        <Textarea
          id="reason"
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: Renegociação do contrato com a operadora, reajuste anual, etc."
          className="min-h-[80px]"
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Salvando…' : 'Criar versão de preço'}
      </Button>

      {error ? (
        <p className="rounded-md border border-rose-100 bg-rose-50 p-3 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}
    </form>
  )
}

function toCents(input: string): number | null {
  const cleaned = input.trim().replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (Number.isNaN(value) || value < 0) return null
  return Math.round(value * 100)
}
