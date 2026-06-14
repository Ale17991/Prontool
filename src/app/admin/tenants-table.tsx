'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, Loader2 } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ALL_MODULES,
  COMING_SOON_MODULES,
  PLAN_LABEL,
  type ModuleId,
  type Plan,
} from '@/lib/core/entitlements/plans'
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
  treino: 'Treino',
  dieta: 'Dieta',
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
  const router = useRouter()
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

  // Entrar na clínica: assume o tenant (auth_hook concede admin) e abre o app.
  function enter() {
    setFeedback(null)
    startTransition(async () => {
      const res = await fetch('/api/auth/switch-tenant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: row.tenantId }),
      })
      if (!res.ok) {
        setFeedback({ kind: 'error', msg: 'Não foi possível entrar na clínica.' })
        return
      }
      const sb = createSupabaseBrowserClient()
      await sb.auth.refreshSession()
      router.push('/operacao/atendimentos')
      router.refresh()
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
            {ALL_MODULES.map((m) => {
              const comingSoon = COMING_SOON_MODULES.includes(m)
              return (
                <label
                  key={m}
                  title={comingSoon ? 'Em breve — módulo ainda não disponível' : undefined}
                  className={cn(
                    'flex items-center gap-1 text-[11px] font-medium',
                    comingSoon
                      ? 'cursor-not-allowed text-slate-400'
                      : 'cursor-pointer text-slate-600',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={modules.has(m)}
                    disabled={comingSoon}
                    onChange={(e) => toggle(m, e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                  />
                  {MODULE_LABEL[m]}
                  {comingSoon ? (
                    <span className="ml-0.5 rounded bg-slate-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-400">
                      em breve
                    </span>
                  ) : null}
                </label>
              )
            })}
          </div>

          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Salvar
          </Button>
          <Button size="sm" variant="outline" onClick={enter} disabled={pending}>
            <LogIn className="mr-1 h-3 w-3" /> Entrar
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
