'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Calculator } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { percentToBps, bpsToPercent } from '@/lib/validation/rate-bps'

/**
 * Feature 011 — US2 — controle de alíquota retida pelo convênio.
 *
 * Checkbox "Convênio cobra imposto?" + campo "Alíquota %".
 * Desmarcar e salvar zera `tax_rate_bps`. Marcar exige preencher valor > 0.
 *
 * RBAC: editável apenas para admin (corresponde a `plan.write` no MATRIX).
 * Leitura para outros perfis exibe valor read-only.
 */
interface PlanTaxRateFormProps {
  planId: string
  initialTaxRateBps: number
  canWrite: boolean
}

export function PlanTaxRateForm({
  planId,
  initialTaxRateBps,
  canWrite,
}: PlanTaxRateFormProps) {
  const router = useRouter()
  const [chargesTax, setChargesTax] = useState(initialTaxRateBps > 0)
  const [ratePercent, setRatePercent] = useState(
    initialTaxRateBps > 0 ? bpsToPercent(initialTaxRateBps) : '',
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    let taxRateBps = 0
    if (chargesTax) {
      try {
        taxRateBps = percentToBps(ratePercent)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Alíquota inválida.')
        return
      }
      if (taxRateBps === 0) {
        setError('Alíquota deve ser maior que zero quando o convênio cobra imposto.')
        return
      }
    }

    setPending(true)
    try {
      const res = await fetch(`/api/planos/${planId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tax_rate_bps: taxRateBps }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      setSuccess(
        taxRateBps > 0
          ? `Alíquota do convênio salva: ${bpsToPercent(taxRateBps)} %`
          : 'Convênio não cobra mais imposto.',
      )
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  // Modo read-only para perfis sem permissão.
  if (!canWrite) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Calculator className="h-4 w-4 text-primary" />
            Imposto do convênio
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-700">
            {initialTaxRateBps > 0 ? (
              <>
                Este convênio retém{' '}
                <strong className="text-slate-900">{bpsToPercent(initialTaxRateBps)} %</strong>{' '}
                sobre o faturamento.
              </>
            ) : (
              <>Este convênio não cobra imposto sobre o faturamento.</>
            )}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Calculator className="h-4 w-4 text-primary" />
          Imposto do convênio
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={chargesTax}
              onChange={(e) => {
                setChargesTax(e.target.checked)
                if (!e.target.checked) setRatePercent('')
              }}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
            />
            Convênio cobra imposto?
          </label>

          {chargesTax ? (
            <div className="space-y-1.5">
              <Label htmlFor="plan-tax-rate" className="text-xs">
                Alíquota do convênio (%)
              </Label>
              <Input
                id="plan-tax-rate"
                value={ratePercent}
                onChange={(e) => setRatePercent(e.target.value)}
                placeholder="Ex.: 6,50"
                inputMode="decimal"
                required
              />
              <p className="text-[10px] text-slate-500">
                Percentual que o convênio retém/cobra sobre o faturamento bruto.
              </p>
            </div>
          ) : null}

          <Button
            type="submit"
            disabled={pending || (chargesTax && ratePercent.trim().length === 0)}
          >
            {pending ? 'Salvando…' : 'Salvar'}
          </Button>

          {error ? (
            <p className="rounded-md border border-rose-100 bg-rose-50 p-3 text-xs font-medium text-rose-700">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="rounded-md border border-emerald-100 bg-emerald-50 p-3 text-xs font-medium text-emerald-700">
              {success}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}
