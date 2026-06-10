'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ALL_MODULES, PLAN_LABEL, type ModuleId, type Plan } from '@/lib/core/entitlements/plans'
import { setTenantPlanAction } from './actions'

export interface AdminTenantRow {
  tenantId: string
  name: string
  slug: string
  tenantStatus: string
  plan: Plan
  modules: string[]
}

const PLANS: Plan[] = ['essencial', 'pro', 'clinica', 'legacy']
const MODULE_LABEL: Record<ModuleId, string> = {
  tiss: 'TISS',
  portal_paciente: 'Portal',
  telemedicina: 'Telemedicina',
  crm: 'CRM',
}

export function AdminTenantsTable({ rows }: { rows: AdminTenantRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">Nenhuma clínica cadastrada.</p>
  }
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <TenantRow key={r.tenantId} row={r} />
      ))}
    </div>
  )
}

function TenantRow({ row }: { row: AdminTenantRow }) {
  const [plan, setPlan] = useState<Plan>(row.plan)
  const [modules, setModules] = useState<Set<ModuleId>>(
    new Set(row.modules.filter((m): m is ModuleId => (ALL_MODULES as readonly string[]).includes(m))),
  )
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(m: ModuleId, on: boolean) {
    setModules((prev) => {
      const next = new Set(prev)
      if (on) next.add(m)
      else next.delete(m)
      return next
    })
  }

  function save() {
    setFeedback(null)
    startTransition(async () => {
      const res = await setTenantPlanAction({ tenantId: row.tenantId, plan, modules: [...modules] })
      setFeedback(
        res.ok
          ? { kind: 'ok', msg: 'Salvo.' }
          : { kind: 'error', msg: res.error ?? 'Erro ao salvar.' },
      )
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">{row.name}</p>
          <p className="text-[11px] text-slate-400">
            {row.slug} · {row.tenantStatus}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            Plano
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as Plan)}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {PLAN_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2">
            {ALL_MODULES.map((m) => (
              <label
                key={m}
                className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-slate-600"
              >
                <input
                  type="checkbox"
                  checked={modules.has(m)}
                  onChange={(e) => toggle(m, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30"
                />
                {MODULE_LABEL[m]}
              </label>
            ))}
          </div>

          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Salvar
          </Button>
        </div>
      </div>
      {feedback ? (
        <p
          className={cn(
            'mt-2 text-[11px] font-medium',
            feedback.kind === 'ok' ? 'text-success-strong' : 'text-destructive',
          )}
        >
          {feedback.msg}
        </p>
      ) : null}
    </div>
  )
}
