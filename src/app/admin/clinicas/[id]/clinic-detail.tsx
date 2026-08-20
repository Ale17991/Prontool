'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  CalendarDays,
  Eye,
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
  MODULE_BLOCKS,
  MODULE_HINT,
  MODULE_LABEL,
  PLAN_LABEL,
  type ModuleBlock,
  type ModuleId,
  type Plan,
} from '@/lib/core/entitlements/plans'
import { labelForRole } from '@/lib/core/team/types'
import type { TenantRole } from '@/lib/db/types'
import {
  setTenantPlanAction,
  setTenantStatusAction,
  setTenantBillingAction,
  adminLogEnterClinicAction,
} from '../../actions'
import { adminSendResetEmailAction } from '../../usuarios/actions'

const BILLING_OPTIONS: { value: BillingStatus; label: string }[] = [
  { value: 'active', label: 'Ativo (pagante)' },
  { value: 'trial', label: 'Trial' },
  { value: 'past_due', label: 'Inadimplente' },
  { value: 'canceled', label: 'Cancelado' },
]

const PLANS: Plan[] = ['essencial', 'pro', 'clinica', 'legacy']

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

export interface AuditEntry {
  actorName: string
  entity: string
  field: string | null
  oldValue: string | null
  newValue: string | null
  reason: string | null
  createdAt: string
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
  audit,
  isSuper,
}: {
  row: ClinicDetailRow
  metrics: Metrics
  users: ClinicUserRow[]
  audit: AuditEntry[]
  isSuper: boolean
}) {
  const router = useRouter()
  const [plan, setPlan] = useState<Plan>(row.plan)
  const [modules, setModules] = useState<Set<ModuleId>>(
    new Set(
      row.modules.filter((m): m is ModuleId => (ALL_MODULES as readonly string[]).includes(m)),
    ),
  )
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [entering, setEntering] = useState<'edit' | 'view' | null>(null)
  const [status, setStatus] = useState<'active' | 'suspended'>(row.status)
  const [statusPending, startStatusTransition] = useTransition()
  const [resetSending, setResetSending] = useState<string | null>(null)
  const [userNotice, setUserNotice] = useState<string | null>(null)
  const [billing, setBilling] = useState<BillingStatus>(row.billingStatus)
  const [trialEnds, setTrialEnds] = useState<string>(
    row.trialEndsAt ? row.trialEndsAt.slice(0, 10) : '',
  )
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
      setBillingFeedback(res.ok ? 'Cobrança salva.' : (res.error ?? 'Erro ao salvar.'))
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

  /** Atalho: liga/desliga o bloco inteiro, respeitando os "em breve". */
  function toggleBlock(block: ModuleBlock, on: boolean) {
    setModules((prev) => {
      const next = new Set(prev)
      for (const m of block.modules) {
        if (COMING_SOON_MODULES.includes(m)) continue
        if (on) next.add(m)
        else next.delete(m)
      }
      return next
    })
  }

  function save() {
    setFeedback(null)
    // Preview do que muda + confirmação (evita desligar módulo por engano).
    const before = new Set(
      row.modules.filter((m): m is ModuleId => (ALL_MODULES as readonly string[]).includes(m)),
    )
    const added = [...modules].filter((m) => !before.has(m))
    const removed = [...before].filter((m) => !modules.has(m))
    const planChanged = plan !== row.plan
    if (!planChanged && added.length === 0 && removed.length === 0) {
      setFeedback({ kind: 'ok', msg: 'Nada para salvar.' })
      return
    }
    const lbl = (m: ModuleId) => MODULE_LABEL[m]
    const summary = [
      planChanged ? `Plano: ${PLAN_LABEL[row.plan]} → ${PLAN_LABEL[plan]}` : null,
      added.length ? `Ativar: ${added.map(lbl).join(', ')}` : null,
      removed.length ? `Desativar: ${removed.map(lbl).join(', ')}` : null,
      // Memed não é só mais uma tela: muda o que a recepção é obrigada a
      // digitar. Vale dizer em voz alta antes de salvar.
      added.includes('memed')
        ? '\n⚠ Prescrição Memed ligada: novos cadastros passarão a exigir CPF, e-mail e data de nascimento (aqui e no agendamento público).'
        : null,
      removed.includes('memed')
        ? '\n⚠ Prescrição Memed desligada: o cadastro volta a exigir só nome e telefone.'
        : null,
    ]
      .filter(Boolean)
      .join('\n')
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Confirmar mudanças na clínica?\n\n${summary}`)
    ) {
      return
    }
    startTransition(async () => {
      const res = await setTenantPlanAction({ tenantId: row.tenantId, plan, modules: [...modules] })
      setFeedback(
        res.ok
          ? { kind: 'ok', msg: 'Salvo.' }
          : { kind: 'error', msg: res.error ?? 'Erro ao salvar.' },
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

  function enter(mode: 'edit' | 'view') {
    setFeedback(null)
    setEntering(mode)
    void (async () => {
      try {
        void adminLogEnterClinicAction(row.tenantId)
        // "edit" = switch de escrita (super-admin, 0171). "view" = impersonação
        // READ-ONLY (escrita bloqueada no servidor pelo middleware).
        const url = mode === 'edit' ? '/api/admin/enter-edit' : '/api/admin/impersonation/start'
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenantId: row.tenantId }),
        })
        if (!res.ok) {
          setFeedback({ kind: 'error', msg: 'Não foi possível entrar na clínica.' })
          setEntering(null)
          return
        }
        const sb = createSupabaseBrowserClient()
        await sb.auth.refreshSession()
        router.push('/operacao/atendimentos')
        router.refresh()
      } catch {
        setFeedback({ kind: 'error', msg: 'Não foi possível entrar na clínica.' })
        setEntering(null)
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
                status === 'active'
                  ? 'bg-success-bg text-success-text'
                  : 'bg-amber-100 text-amber-700',
              )}
            >
              {status === 'active' ? 'Ativa' : 'Suspensa'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">{row.slug}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSuper ? (
            <Button
              variant="default"
              onClick={() => enter('edit')}
              disabled={entering !== null}
              title="Entrar na clínica com permissão de edição"
            >
              {entering === 'edit' ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="mr-1.5 h-4 w-4" />
              )}
              Entrar e editar
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => enter('view')}
            disabled={entering !== null}
            title="Entrar apenas para visualizar (somente-leitura)"
          >
            {entering === 'view' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Eye className="mr-1.5 h-4 w-4" />
            )}
            Só visualizar
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
        <MetricCard
          icon={CalendarDays}
          label="Atendimentos"
          value={String(metrics.appointmentCount)}
        />
        <MetricCard
          icon={Activity}
          label="Última atividade"
          value={
            metrics.lastActivity ? new Date(metrics.lastActivity).toLocaleDateString('pt-BR') : '—'
          }
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
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Módulos por especialidade
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {MODULE_BLOCKS.map((block) => (
                <ModuleBlockCard
                  key={block.id}
                  block={block}
                  active={modules}
                  onToggleModule={toggle}
                  onToggleBlock={toggleBlock}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
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
            {billingPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
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
          <p className="mt-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            {userNotice}
          </p>
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

      {/* Auditoria recente */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">Atividade recente</h3>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Últimas alterações registradas nesta clínica (auditoria).
        </p>
        {audit.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">Nenhum registro de auditoria.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {audit.map((a, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-slate-100 pb-1.5 text-xs last:border-0"
              >
                <span className="whitespace-nowrap text-slate-400">{fmtWhen(a.createdAt)}</span>
                <span className="font-semibold text-slate-700">{a.actorName}</span>
                <span className="text-slate-500">{describeAudit(a)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function describeAudit(a: AuditEntry): string {
  const ent = a.entity.replace(/_/g, ' ')
  const change =
    a.oldValue !== null || a.newValue !== null ? ` ${a.oldValue ?? '∅'} → ${a.newValue ?? '∅'}` : ''
  return `${a.field ?? 'alterou'} em ${ent}${change}`
}

/**
 * Um bloco do catálogo. O cabeçalho liga/desliga tudo de uma vez (atalho);
 * cada linha continua ligável sozinha — clínica raramente contrata a
 * especialidade inteira.
 */
function ModuleBlockCard({
  block,
  active,
  onToggleModule,
  onToggleBlock,
}: {
  block: ModuleBlock
  active: Set<ModuleId>
  onToggleModule: (m: ModuleId, on: boolean) => void
  onToggleBlock: (block: ModuleBlock, on: boolean) => void
}) {
  const available = block.modules.filter((m) => !COMING_SOON_MODULES.includes(m))
  const onCount = available.filter((m) => active.has(m)).length
  const allOn = available.length > 0 && onCount === available.length

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-900">{block.label}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{block.hint}</p>
        </div>
        <button
          type="button"
          onClick={() => onToggleBlock(block, !allOn)}
          className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 transition hover:border-primary hover:text-primary"
        >
          {allOn ? 'Desativar tudo' : 'Ativar tudo'}
        </button>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {block.modules.map((m) => {
          const comingSoon = COMING_SOON_MODULES.includes(m)
          return (
            <label
              key={m}
              title={comingSoon ? 'Em breve — módulo ainda não disponível' : MODULE_HINT[m]}
              className={cn(
                'flex items-start gap-2 rounded-md px-1.5 py-1 text-xs font-medium',
                comingSoon
                  ? 'cursor-not-allowed text-slate-400'
                  : 'cursor-pointer text-slate-700 hover:bg-white',
              )}
            >
              <input
                type="checkbox"
                checked={active.has(m)}
                disabled={comingSoon}
                onChange={(e) => onToggleModule(m, e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  {MODULE_LABEL[m]}
                  {comingSoon ? (
                    <span className="rounded bg-slate-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-400">
                      em breve
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[10px] font-normal leading-snug text-slate-400">
                  {MODULE_HINT[m]}
                </span>
                {m === 'memed' && active.has(m) ? (
                  <span className="mt-1 block rounded bg-amber-50 px-1.5 py-1 text-[10px] font-medium leading-snug text-amber-700">
                    Cadastro de paciente passa a exigir CPF, e-mail e nascimento — inclusive no
                    agendamento público. Pacientes já cadastrados não são bloqueados.
                  </span>
                ) : null}
              </span>
            </label>
          )
        })}
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
