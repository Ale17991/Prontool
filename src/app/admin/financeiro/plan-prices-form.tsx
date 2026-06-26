'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PLAN_LABEL, type Plan } from '@/lib/core/entitlements/plans'
import type { PlanPrices } from '@/lib/core/admin/plan-prices'
import { adminSetPlanPriceAction } from './actions'

const PLANS: Plan[] = ['essencial', 'pro', 'clinica', 'legacy']

/** Reais (string) → centavos inteiros. */
function toCents(reais: string): number {
  const n = Number(reais.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

export function PlanPricesForm({ prices }: { prices: PlanPrices }) {
  const [vals, setVals] = useState<Record<Plan, string>>(() => {
    const o = {} as Record<Plan, string>
    for (const p of PLANS) o[p] = (prices[p] / 100).toFixed(2)
    return o
  })
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function save() {
    setMsg(null)
    start(async () => {
      const changes = PLANS.filter((p) => toCents(vals[p]) !== prices[p])
      if (changes.length === 0) {
        setMsg({ kind: 'ok', text: 'Nada para salvar.' })
        return
      }
      for (const p of changes) {
        const res = await adminSetPlanPriceAction(p, toCents(vals[p]))
        if (!res.ok) {
          setMsg({ kind: 'err', text: `${PLAN_LABEL[p]}: ${res.error ?? 'falha'}` })
          return
        }
      }
      setMsg({ kind: 'ok', text: 'Preços salvos.' })
    })
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-bold text-slate-900">Preços de plano (mensal)</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {PLANS.map((p) => (
          <div key={p}>
            <Label className="text-[11px] font-bold uppercase text-slate-500">{PLAN_LABEL[p]}</Label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-400">R$</span>
              <Input
                value={vals[p]}
                onChange={(e) => setVals((s) => ({ ...s, [p]: e.target.value }))}
                inputMode="decimal"
                className="h-8 text-xs"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Salvar preços
        </Button>
        {msg ? (
          <span className={`text-xs font-semibold ${msg.kind === 'ok' ? 'text-success-text' : 'text-destructive'}`}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </section>
  )
}
