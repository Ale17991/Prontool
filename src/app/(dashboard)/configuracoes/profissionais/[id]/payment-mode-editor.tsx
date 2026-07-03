'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type PaymentMode = 'comissionado' | 'fixo' | 'liberal'

const PAYMENT_MODE_OPTIONS: Array<{ value: PaymentMode; label: string }> = [
  { value: 'comissionado', label: 'Comissionado (% sobre atendimentos)' },
  { value: 'fixo', label: 'Fixo (salário mensal)' },
  { value: 'liberal', label: 'Liberal (por participação como assistente)' },
]

export interface PaymentModeEditorProps {
  doctorId: string
  currentMode: PaymentMode
  currentPercentageBps: number | null
  currentMonthlyAmountCents: number | null
  currentBillingDay: number | null
  currentLiberalDefaultCents: number | null
}

export function PaymentModeEditor(props: PaymentModeEditorProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<PaymentMode>(props.currentMode)
  const [percentStr, setPercentStr] = useState(
    props.currentPercentageBps !== null
      ? (props.currentPercentageBps / 100).toString().replace('.', ',')
      : '',
  )
  const [monthlyAmountStr, setMonthlyAmountStr] = useState(
    props.currentMonthlyAmountCents !== null
      ? (props.currentMonthlyAmountCents / 100).toFixed(2).replace('.', ',')
      : '',
  )
  const [billingDay, setBillingDay] = useState(
    props.currentBillingDay !== null ? String(props.currentBillingDay) : '1',
  )
  const [liberalDefaultStr, setLiberalDefaultStr] = useState(
    props.currentLiberalDefaultCents !== null
      ? (props.currentLiberalDefaultCents / 100).toFixed(2).replace('.', ',')
      : '',
  )
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const change: Record<string, unknown> = {
      payment_mode: mode,
      valid_from: validFrom,
      reason: reason.trim(),
    }
    if (mode === 'comissionado') {
      const bps = toBps(percentStr)
      if (bps === null) {
        setError('Comissão deve ser um percentual válido (ex.: 40 ou 37,5).')
        return
      }
      change.percentage_bps = bps
    } else if (mode === 'fixo') {
      const cents = toCents(monthlyAmountStr)
      if (cents === null || cents <= 0) {
        setError('Valor mensal deve ser maior que zero.')
        return
      }
      const day = Number(billingDay)
      if (!Number.isInteger(day) || day < 1 || day > 28) {
        setError('Dia de faturamento deve ser inteiro entre 1 e 28.')
        return
      }
      change.monthly_amount_cents = cents
      change.billing_day = day
    } else {
      const cents = toCents(liberalDefaultStr)
      if (cents === null || cents <= 0) {
        setError('Valor padrão por participação deve ser maior que zero.')
        return
      }
      change.liberal_default_cents = cents
    }

    if (reason.trim().length < 3) {
      setError('Motivo deve ter ao menos 3 caracteres.')
      return
    }

    setPending(true)
    try {
      const res = await fetch(`/api/medicos/${props.doctorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payment_mode_change: change }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(body.error?.message ?? `HTTP ${res.status}`)
      }
      setOpen(false)
      setReason('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8"
      >
        Alterar modalidade
      </Button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="pm-mode" className="text-xs">
          Nova modalidade
        </Label>
        <select
          id="pm-mode"
          required
          value={mode}
          onChange={(e) => setMode(e.target.value as PaymentMode)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PAYMENT_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {mode === 'comissionado' ? (
        <div className="space-y-1.5">
          <Label htmlFor="pm-percent" className="text-xs">
            Comissão (%)
          </Label>
          <Input
            id="pm-percent"
            required
            inputMode="decimal"
            value={percentStr}
            onChange={(e) => setPercentStr(e.target.value)}
            placeholder="40"
          />
        </div>
      ) : null}

      {mode === 'fixo' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pm-monthly" className="text-xs">
              Valor mensal (R$)
            </Label>
            <Input
              id="pm-monthly"
              required
              inputMode="decimal"
              value={monthlyAmountStr}
              onChange={(e) => setMonthlyAmountStr(e.target.value)}
              placeholder="8000,00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-day" className="text-xs">
              Dia de faturamento
            </Label>
            <Input
              id="pm-day"
              required
              type="number"
              min={1}
              max={28}
              value={billingDay}
              onChange={(e) => setBillingDay(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      {mode === 'liberal' ? (
        <div className="space-y-1.5">
          <Label htmlFor="pm-liberal" className="text-xs">
            Valor padrão por participação (R$)
          </Label>
          <Input
            id="pm-liberal"
            required
            inputMode="decimal"
            value={liberalDefaultStr}
            onChange={(e) => setLiberalDefaultStr(e.target.value)}
            placeholder="350,00"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pm-valid-from" className="text-xs">
            Vigência a partir de
          </Label>
          <Input
            id="pm-valid-from"
            required
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pm-reason" className="text-xs">
            Motivo
          </Label>
          <Input
            id="pm-reason"
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: Mudança para CLT"
          />
        </div>
      </div>

      <p className="text-[10px] text-slate-500">
        A modalidade anterior permanece válida para atendimentos passados — Constitution I:
        histórico congela na mudança. Audit log registra ator + valores anteriores e novos.
      </p>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending} size="sm">
          {pending ? 'Salvando…' : 'Salvar modalidade'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={pending}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function toBps(input: string): number | null {
  const cleaned = input.trim().replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const v = Number(cleaned)
  if (Number.isNaN(v) || v < 0 || v > 100) return null
  return Math.round(v * 100)
}

function toCents(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/R\$\s*/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const v = Number(cleaned)
  if (Number.isNaN(v) || v < 0) return null
  return Math.round(v * 100)
}
