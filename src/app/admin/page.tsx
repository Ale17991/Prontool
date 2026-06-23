import Link from 'next/link'
import {
  Building2,
  LifeBuoy,
  Users,
  ArrowRight,
  CalendarDays,
  Wallet,
  PauseCircle,
  AlertTriangle,
} from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { PLAN_LABEL, type Plan } from '@/lib/core/entitlements/plans'
import { formatCurrency } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface AgencyOverview {
  clinics_active: number
  clinics_suspended: number
  users_active: number
  appointments_total: number
  revenue_net_cents: number
  trials: number
  past_due: number
}

/**
 * Feature 031 — Visão geral do Painel Agência. Resumo + o que cada seção faz
 * (legibilidade: alguém que chega hoje entende o painel inteiro).
 */
export default async function AdminOverviewPage() {
  const sb: any = createSupabaseServiceClient()
  const [ovRes, entRes, paRes] = await Promise.all([
    // Função 0158 — KPIs consolidados. Fallback se ainda não aplicada.
    sb.rpc('admin_agency_overview'),
    sb.from('tenant_entitlements').select('plan'),
    sb.from('platform_admins').select('user_id, is_super'),
  ])
  const ov = (ovRes.data ?? null) as AgencyOverview | null

  const planCounts: Record<string, number> = {}
  for (const e of (entRes.data ?? []) as Array<{ plan: string }>) {
    planCounts[e.plan] = (planCounts[e.plan] ?? 0) + 1
  }
  const admins = (paRes.data ?? []) as Array<{ is_super: boolean }>
  const supportCount = admins.filter((p) => !p.is_super).length

  const planLine = (['essencial', 'pro', 'clinica', 'legacy'] as Plan[])
    .filter((p) => planCounts[p])
    .map((p) => `${planCounts[p]} ${PLAN_LABEL[p]}`)
    .join(' · ')

  const clinicsActive = ov?.clinics_active ?? 0
  const clinicsSuspended = ov?.clinics_suspended ?? 0

  const sections = [
    {
      href: '/admin/clinicas',
      icon: Building2,
      title: 'Clínicas & planos',
      desc: 'Veja todas as clínicas, defina plano e módulos de cada uma e entre na clínica para dar suporte.',
    },
    {
      href: '/admin/suporte',
      icon: LifeBuoy,
      title: 'Equipe de suporte',
      desc: 'Defina quais clínicas cada usuário de suporte pode acessar.',
    },
    {
      href: '/admin/usuarios',
      icon: Users,
      title: 'Usuários',
      desc: 'Gerencie os usuários de qualquer clínica: papel, status, criar conta e resetar senha.',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900">Visão geral</h2>
        <p className="mt-1 text-sm text-slate-500">
          Painel da agência para administrar todas as clínicas — planos, acessos do suporte e
          usuários. Use o menu à esquerda para navegar.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={Building2}
          label="Clínicas ativas"
          value={String(clinicsActive)}
          hint={planLine || '—'}
        />
        <Stat icon={Users} label="Usuários ativos" value={String(ov?.users_active ?? 0)} hint="em todas as clínicas" />
        <Stat
          icon={CalendarDays}
          label="Atendimentos"
          value={fmtCompact(ov?.appointments_total ?? 0)}
          hint="total na plataforma"
        />
        <Stat
          icon={Wallet}
          label="Faturamento (líquido)"
          value={formatCurrency(ov?.revenue_net_cents ?? 0)}
          hint="soma de todas as clínicas"
          highlight
        />
      </div>

      {clinicsSuspended > 0 || (ov?.trials ?? 0) > 0 || (ov?.past_due ?? 0) > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {clinicsSuspended > 0 ? (
            <Pill icon={PauseCircle} cls="bg-amber-50 text-amber-700 border-amber-200">
              {clinicsSuspended} suspensa{clinicsSuspended === 1 ? '' : 's'}
            </Pill>
          ) : null}
          {(ov?.trials ?? 0) > 0 ? (
            <Pill icon={AlertTriangle} cls="bg-blue-50 text-blue-700 border-blue-200">
              {ov?.trials} em trial
            </Pill>
          ) : null}
          {(ov?.past_due ?? 0) > 0 ? (
            <Pill icon={AlertTriangle} cls="bg-destructive/10 text-destructive border-destructive/20">
              {ov?.past_due} inadimplente{(ov?.past_due ?? 0) === 1 ? '' : 's'}
            </Pill>
          ) : null}
          <Pill icon={LifeBuoy} cls="bg-slate-100 text-slate-600 border-slate-200">
            {supportCount} no suporte
          </Pill>
        </div>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Seções</h3>
        {sections.map((s) => {
          const Icon = s.icon
          return (
            <Link
              key={s.href}
              href={s.href}
              className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-900">{s.title}</p>
                <p className="text-xs text-slate-500">{s.desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 self-center text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: typeof Building2
  label: string
  value: string
  hint: string
  highlight?: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`mt-0.5 truncate text-xl font-black ${highlight ? 'text-success-strong' : 'text-slate-900'}`}
        title={value}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-slate-500">{hint}</p>
    </div>
  )
}

function Pill({
  icon: Icon,
  cls,
  children,
}: {
  icon: typeof Building2
  cls: string
  children: React.ReactNode
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {children}
    </span>
  )
}

function fmtCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}
