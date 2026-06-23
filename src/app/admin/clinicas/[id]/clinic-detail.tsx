'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  CalendarDays,
  KeyRound,
  LogIn,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plug,
  Save,
  Users,
} from 'lucide-react'
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
import { labelForRole } from '@/lib/core/team/types'
import type { TenantRole } from '@/lib/db/types'
import { setTenantPlanAction, setTenantStatusAction, setTenantBillingAction } from '../../actions'
import { adminSendResetEmailAction } from '../../usuarios/actions'

const BILLING_OPTIONS: { value: BillingStatus; label: string }[] = [
  { value: 'active', label: 'Ativo (pagante)' },
  { value: 'trial', label: 'Trial' },
  { value: 'past_due', label: 'Inadimplente' },
  { value: 'canceled', label: 'Cancelado' },
]

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

export type BillingStatus = 'trial' | 'active' | 'past_due' | 'canceled'

export interface ClinicDetailRow {
  tenantId: string
  name: string
  slug: string
  status: 'active' | 'suspended'
  plan: Plan
  modules: string[]
  billingStatus: BillingStatus
  trialEndsAt: string | null
}

export interface ClinicUserRow {
  userId: string
  name: string
  email: string
  role: TenantRole
  status: 'active' | 'pending' | 'disabled'
}

interface Metrics {
  userCount: number
  appointmentCount: number
  lastActivity: string | null
  integrations: string[]
}

export function ClinicDetail({
  row,
  metrics,
  users,
}: {
  row: ClinicDetailRow
  metrics: Metrics
  users: ClinicUserRow[]
}) {
  const router = useRouter()
  const [plan, setPlan] = useState<Plan>(row.plan)
  const [modules, setModules] = useState<Set<ModuleId>>(
    new Set(row.modules.filter((m): m is ModuleId => (ALL_MODULES as readonly string[]).includes(m))),
  )
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [entering, setEntering] = useState(false)
  const [status, setStatus] = useState<'active' | 'suspended'>(row.status)
  const [statusPending, startStatusTransition] = useTransition()
  const [resetSending, setResetSending] = useState<string | null>(null)
  const [userNotice, setUserNotice] = useState<string | null>(null)
  const [billing, setBilling] = useState<BillingStatus>(row.billingStatus)
  const [trialEnds, setTrialEnds] = useState<string>(row.trialEndsAt ? row.trialEndsAt.slice(0, 10) : '')
  const [billingPending, startBillingTransition] = useTransition()
  const [billingFeedback, setBillingFeedback] = useState<string | null>(null)

  function saveBilling() {
    setBillingFeedback(null)
    startBillingTransition(async () => {
      const res = await setTenantBillingAction({
        tenantId: row.tenantId,
        status: billing,
        trialEndsAt: billing === 'trial' ? trialEnds || null : null,
      })
      setBillingFeedback(res.ok ? 'Cobrança salva.' : res.error ?? 'Erro ao salvar.')
      if (res.ok) router.refresh()
    })
  }

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
      if (res.ok) router.refresh()
    })
  }

  function toggleStatus() {
    const next = status === 'active' ? 'suspended' : 'active'
    if (
      next === 'suspended' &&
      typeof window !== 'undefined' &&
      !window.confirm('Suspender esta clínica? Todos os usuários perdem o acesso até reativar.')
    ) {
      return
    }
    startStatusTransition(async () => {
      const res = await setTenantStatusAction({ tenantId: row.tenantId, status: next })
      if (res.ok) setStatus(next)
      else setFeedback({ kind: 'error', msg: res.error ?? 'Erro ao alterar status.' })
    })
  }

  function sendReset(u: ClinicUserRow) {
    setUserNotice(null)
    setResetSending(u.userId)
    void (async () => {
      const res = await adminSendResetEmailAction(u.userId)
      setResetSending(null)
      setUserNotice(
        res.ok
          ? `E-mail de redefinição enviado para ${u.email}.`
          : (res.error ?? 'Falha ao enviar e-mail.'),
      )
    })()
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
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black tracking-tight text-slate-900">{row.name}</h2>
            <span
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-semibold',
                status === 'active' ? 'bg-success-bg text-success-text' : 'bg-amber-100 text-amber-700',
              )}
            >
              {status === 'active' ? 'Ativa' : 'Suspensa'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">{row.slug}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={enter} disabled={entering}>
            {entering ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <LogIn className="mr-1.5 h-4 w-4" />}
            Entrar na clínica
          </Button>
          <Button
            variant={status === 'active' ? 'outline' : 'default'}
            onClick={toggleStatus}
            disabled={statusPending}
            className={status === 'active' ? 'text-destructive' : undefined}
          >
            {statusPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : status === 'active' ? (
              <PauseCircle className="mr-1.5 h-4 w-4" />
            ) : (
              <PlayCircle className="mr-1.5 h-4 w-4" />
            )}
            {status === 'active' ? 'Suspender' : 'Reativar'}
          </Button>
        </div>
      </div>

      {/* Visão geral (métricas) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard icon={Users} label="Usuários" value={String(metrics.userCount)} />
        <MetricCard icon={CalendarDays} label="Atendimentos" value={String(metrics.appointmentCount)} />
        <MetricCard
          icon={Activity}
          label="Última atividade"
          value={metrics.lastActivity ? new Date(metrics.lastActivity).toLocaleDateString('pt-BR') : '—'}
        />
        <MetricCard
          icon={Plug}
          label="Integrações"
          value={metrics.integrations.length > 0 ? metrics.integrations.join(', ') : 'Nenhuma'}
        />
      </div>

      {/* Plano & módulos */}
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
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Módulos (ative/desative individualmente)
            </p>
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

      {/* Cobrança */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">Cobrança</h3>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Situação financeira da clínica (separado de pausar/reativar o acesso).
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-600">
            <span className="mb-1 block">Status</span>
            <select
              value={billing}
              onChange={(e) => setBilling(e.target.value as BillingStatus)}
              className="h-9 rounded-md border border-slate-200 px-2 text-sm"
            >
              {BILLING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {billing === 'trial' ? (
            <label className="text-xs font-medium text-slate-600">
              <span className="mb-1 block">Trial termina em</span>
              <input
                type="date"
                value={trialEnds}
                onChange={(e) => setTrialEnds(e.target.value)}
                className="h-9 rounded-md border border-slate-200 px-2 text-sm"
              />
            </label>
          ) : null}
          <Button size="sm" onClick={saveBilling} disabled={billingPending}>
            {billingPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Salvar cobrança
          </Button>
          {billingFeedback ? (
            <span className="text-xs font-medium text-slate-500">{billingFeedback}</span>
          ) : null}
        </div>
      </div>

      {/* Usuários da clínica */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">Usuários ({users.length})</h3>
        {userNotice ? (
          <p className="mt-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-600">{userNotice}</p>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-widest text-slate-400">
                <th className="py-2 pr-3 font-bold">Nome</th>
                <th className="py-2 pr-3 font-bold">Função</th>
                <th className="py-2 pr-3 font-bold">Status</th>
                <th className="py-2 text-right font-bold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-xs text-slate-400">
                    Nenhum usuário nesta clínica.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.userId} className="border-b border-slate-100">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-900">{u.name}</div>
                      <div className="text-[11px] text-slate-400">{u.email}</div>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-600">{labelForRole(u.role)}</td>
                    <td className="py-2 pr-3 text-xs text-slate-600">{u.status}</td>
                    <td className="py-2 text-right">
                      {u.status === 'active' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => sendReset(u)}
                          disabled={resetSending === u.userId}
                          title="Enviar e-mail de redefinição de senha"
                          className="gap-1.5"
                        >
                          {resetSending === u.userId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <KeyRound className="h-3.5 w-3.5" />
                          )}
                          Reset de senha
                        </Button>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-bold text-slate-900" title={value}>
        {value}
      </p>
    </div>
  )
}
