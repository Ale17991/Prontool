'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, Loader2, Save } from 'lucide-react'
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
import { setTenantPlanAction } from '../../actions'

const PLANS: Plan[] = ['essencial', 'pro', 'clinica', 'legacy']
const MODULE_LABEL: Record<ModuleId, string> = {
  tiss: 'TISS',
  portal_paciente: 'Portal',
  telemedicina: 'Telemedicina',
  crm: 'CRM',
  treino: 'Treino',
  dieta: 'Dieta',
  endocrino: 'Endócrino',
}

export interface ClinicDetailRow {
  tenantId: string
  name: string
  plan: Plan
  modules: string[]
}

export function ClinicDetail({ row }: { row: ClinicDetailRow }) {
  const router = useRouter()
  const [plan, setPlan] = useState<Plan>(row.plan)
  const [modules, setModules] = useState<Set<ModuleId>>(
    new Set(row.modules.filter((m): m is ModuleId => (ALL_MODULES as readonly string[]).includes(m))),
  )
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [entering, setEntering] = useState(false)

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
        res.ok ? { kind: 'ok', msg: 'Salvo.' } : { kind: 'error', msg: res.error ?? 'Erro ao salvar.' },
      )
    })
  }

  function enter() {
    setFeedback(null)
    setEntering(true)
    void (async () => {
      try {
        const res = await fetch('/api/auth/switch-tenant', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenantId: row.tenantId }),
        })
        if (!res.ok) {
          setFeedback({ kind: 'error', msg: 'Não foi possível entrar na clínica.' })
          setEntering(false)
          return
        }
        const sb = createSupabaseBrowserClient()
        await sb.auth.refreshSession()
        router.push('/operacao/atendimentos')
        router.refresh()
      } catch {
        setFeedback({ kind: 'error', msg: 'Não foi possível entrar na clínica.' })
        setEntering(false)
      }
    })()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={enter} disabled={entering}>
          {entering ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <LogIn className="mr-1.5 h-4 w-4" />}
          Entrar na clínica
        </Button>
        <span className="text-xs text-slate-400">
          Assume esta clínica como admin para operar/dar suporte.
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">Plano & módulos</h3>
        <div className="mt-3 space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            Plano
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as Plan)}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            >
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {PLAN_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">Módulos</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {ALL_MODULES.map((m) => {
                const comingSoon = COMING_SOON_MODULES.includes(m)
                return (
                  <label
                    key={m}
                    title={comingSoon ? 'Em breve — módulo ainda não disponível' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 text-xs font-medium',
                      comingSoon ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-600',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={modules.has(m)}
                      disabled={comingSoon}
                      onChange={(e) => toggle(m, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                    />
                    {MODULE_LABEL[m]}
                    {comingSoon ? (
                      <span className="rounded bg-slate-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-400">
                        em breve
                      </span>
                    ) : null}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Salvar
            </Button>
            {feedback ? (
              <span
                className={cn(
                  'text-xs font-medium',
                  feedback.kind === 'ok' ? 'text-success-strong' : 'text-destructive',
                )}
              >
                {feedback.msg}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
