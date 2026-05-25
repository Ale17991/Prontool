'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency } from '@/lib/utils'

export function EditPriceForm({
  procedureId,
  planId,
  expectedHeadId,
  currentAmountCents,
}: {
  procedureId: string
  planId: string
  expectedHeadId: string
  currentAmountCents: number
}) {
  const router = useRouter()
  const [amountStr, setAmountStr] = useState('')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setConflict(null)
    const amountCents = toCents(amountStr)
    if (amountCents === null) {
      setError('Informe um valor válido (ex.: 275,00).')
      return
    }
    setPending(true)
    // Flag para impedir double-submit durante a janela router.push.
    let success = false
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
          expected_head_id: expectedHeadId,
        }),
      })
      if (res.status === 409) {
        setConflict(
          'O head da tabela mudou desde que esta tela foi carregada. Recarregando para mostrar a versão atual…',
        )
        router.refresh()
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
      success = true
      router.push(`/configuracoes/precos/${created.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!success) setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-xs text-slate-500">
        Head atual:{' '}
        <span className="font-bold text-slate-700">{formatCurrency(currentAmountCents)}</span>
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="amount" className="text-xs">
            Novo valor (R$)
          </Label>
          <Input
            id="amount"
            required
            inputMode="decimal"
            placeholder="275,00"
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
          placeholder="Ex.: Reajuste anual, renegociação, correção de erro…"
          className="min-h-[80px]"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Salvando…' : 'Criar nova versão'}
      </Button>

      {conflict ? (
        <p className="rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] p-3 text-xs font-medium text-[hsl(var(--warning-foreground))]">
          {conflict}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
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
