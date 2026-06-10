import Link from 'next/link'
import { Building2, LifeBuoy, Users, ArrowRight } from 'lucide-react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { PLAN_LABEL, type Plan } from '@/lib/core/entitlements/plans'

export const dynamic = 'force-dynamic'

/**
 * Feature 031 — Visão geral do Painel Agência. Resumo + o que cada seção faz
 * (legibilidade: alguém que chega hoje entende o painel inteiro).
 */
export default async function AdminOverviewPage() {
  const sb: any = createSupabaseServiceClient()
  const [tenantsRes, entRes, paRes] = await Promise.all([
    sb.from('tenants').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('tenant_entitlements').select('plan'),
    sb.from('platform_admins').select('user_id, is_super'),
  ])
  const tenantCount = tenantsRes.count ?? 0
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Clínicas ativas" value={String(tenantCount)} hint={planLine || '—'} />
        <Stat label="Usuários de suporte" value={String(supportCount)} hint="acesso escopado por clínica" />
        <Stat label="Você" value="Admin geral" hint="acesso total a todas as clínicas" />
      </div>

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

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    </div>
  )
}
