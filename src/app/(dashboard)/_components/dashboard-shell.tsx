'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  DollarSign,
  FileText,
  LayoutDashboard,
  ListChecks,
  Lock,
  Search,
  ScrollText,
  Settings,
  Stethoscope,
  TrendingDown,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { can } from '@/lib/auth/rbac'
import { listFeatureFlags, type FeatureName } from '@/lib/feature-flags'
import type { TenantRole } from '@/lib/db/types'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  show: (ctx: NavContext) => boolean
}

interface Category {
  id: 'operacao' | 'cadastros' | 'analise' | 'configuracoes'
  label: string
  icon: LucideIcon
  items: NavItem[]
}

interface NavContext {
  role: TenantRole
  flags: Record<FeatureName, boolean>
}

const CATEGORIES: readonly Category[] = [
  {
    id: 'operacao',
    label: 'Operação',
    icon: Stethoscope,
    items: [
      {
        href: '/operacao/atendimentos',
        label: 'Atendimentos',
        icon: ClipboardList,
        show: ({ role }) => can(role, 'appointment.read'),
      },
      {
        href: '/operacao/pacientes',
        label: 'Pacientes',
        icon: Users,
        show: ({ role }) => can(role, 'appointment.read'),
      },
      {
        href: '/operacao/alertas',
        label: 'Alertas',
        icon: Bell,
        show: ({ role }) => can(role, 'alert.read'),
      },
      {
        href: '/operacao/dlq',
        label: 'Fila de erros',
        icon: AlertTriangle,
        show: ({ role }) => can(role, 'dlq.read'),
      },
    ],
  },
  {
    id: 'cadastros',
    label: 'Cadastros',
    icon: BookOpen,
    items: [
      {
        href: '/cadastros/precos',
        label: 'Preços',
        icon: DollarSign,
        show: ({ role }) => can(role, 'price.read'),
      },
      {
        href: '/cadastros/procedimentos',
        label: 'Procedimentos',
        icon: ListChecks,
        show: ({ role }) => can(role, 'procedure.read'),
      },
      {
        href: '/cadastros/planos',
        label: 'Planos',
        icon: FileText,
        show: ({ role }) => can(role, 'plan.read'),
      },
      {
        href: '/cadastros/medicos',
        label: 'Médicos',
        icon: UserCheck,
        show: ({ role }) => can(role, 'doctor.read'),
      },
    ],
  },
  {
    id: 'analise',
    label: 'Análise',
    icon: LayoutDashboard,
    items: [
      {
        href: '/analise/relatorios/mensal',
        label: 'Relatórios',
        icon: LayoutDashboard,
        show: ({ role, flags }) => flags.relatorios && can(role, 'report.read'),
      },
      {
        href: '/analise/comissoes',
        label: 'Comissões',
        icon: Calculator,
        show: ({ role, flags }) => flags.comissoes && can(role, 'doctor.read'),
      },
      {
        href: '/analise/despesas',
        label: 'Despesas',
        icon: TrendingDown,
        show: ({ role, flags }) => flags.despesas && role === 'admin',
      },
      {
        href: '/analise/anamnese',
        label: 'Modelos de Anamnese',
        icon: ClipboardCheck,
        show: ({ role, flags }) => flags.anamnese && role === 'admin',
      },
      {
        href: '/analise/auditoria',
        label: 'Auditoria',
        icon: ScrollText,
        show: ({ role }) => can(role, 'audit.read'),
      },
    ],
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    icon: Settings,
    // Single landing page for now; tabs render empty and the page itself
    // shows the ComingSoon placeholder.
    items: [],
  },
]

interface DashboardShellProps {
  role: TenantRole
  email: string | null
  children: ReactNode
}

export function DashboardShell({ role, email, children }: DashboardShellProps) {
  const pathname = usePathname() ?? ''
  const flags = listFeatureFlags()
  const ctx: NavContext = { role, flags }

  const primaryCategories = CATEGORIES.filter((c) => c.id !== 'configuracoes')
  const configCategory = CATEGORIES.find((c) => c.id === 'configuracoes')!

  const activeCategory = CATEGORIES.find((c) => isUnder(pathname, `/${c.id}`))
  const visibleTabs = (activeCategory?.items ?? []).filter((it) => it.show(ctx))

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-100 font-sans">
      <aside className="z-20 flex w-64 shrink-0 flex-col bg-slate-900 p-6 shadow-xl">
        <div className="mb-10 flex items-center gap-3 text-xl font-bold text-white">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary">
            <Stethoscope className="h-5 w-5 text-white" />
          </div>
          <span className="tracking-tight">Homio Faturamento</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
          {primaryCategories.map((cat) => {
            const href = defaultHrefFor(cat, ctx)
            if (!href) return null
            const active = isUnder(pathname, `/${cat.id}`)
            return (
              <SidebarLink
                key={cat.id}
                href={href}
                label={cat.label}
                icon={cat.icon}
                active={active}
              />
            )
          })}

          <div className="my-3 h-px bg-white/5" aria-hidden />

          <SidebarLink
            href="/configuracoes"
            label={configCategory.label}
            icon={configCategory.icon}
            active={isUnder(pathname, '/configuracoes')}
          />
        </nav>

        <div className="mt-auto border-t border-white/5 pt-6">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2 text-slate-400">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-slate-800 text-xs font-bold uppercase text-white">
              {email?.slice(0, 1) ?? '?'}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-xs font-semibold text-white">{email ?? '—'}</p>
              <p className="truncate text-[10px] text-slate-500">{labelForRole(role)}</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <header className="z-10 flex h-[72px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-8 shadow-sm">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">
            {activeCategory?.label ?? 'Painel'}
          </h1>
          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar paciente, atendimento…"
                className="w-64 rounded-xl border border-slate-200 bg-slate-100 py-2 pl-10 pr-4 text-xs outline-none transition-all focus:border-primary/30 focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <button className="relative rounded-xl bg-slate-100 p-2.5 text-slate-500 transition-colors hover:bg-slate-200">
              <Bell className="h-4 w-4" />
            </button>
            <div className="h-6 w-px bg-slate-200" />
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
              title="Sair"
            >
              <Lock className="h-3 w-3" />
              Sair
            </Link>
          </div>
        </header>

        {visibleTabs.length > 0 ? (
          <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-8">
            {visibleTabs.map((tab) => (
              <CategoryTab
                key={tab.href}
                href={tab.href}
                label={tab.label}
                icon={tab.icon}
                active={isUnder(pathname, tab.href)}
              />
            ))}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto p-8">{children}</div>
      </main>
    </div>
  )
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string
  label: string
  icon: LucideIcon
  active: boolean
}) {
  return (
    <Link
      href={href as never}
      className={cn(
        'flex items-center gap-3 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all duration-200',
        active
          ? 'bg-primary/15 text-white shadow-inner ring-1 ring-primary/30'
          : 'text-slate-400 hover:bg-white/5 hover:text-white',
      )}
    >
      <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-slate-500')} />
      {label}
    </Link>
  )
}

function CategoryTab({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string
  label: string
  icon: LucideIcon
  active: boolean
}) {
  return (
    <Link
      href={href as never}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex items-center gap-2 border-b-2 px-4 py-3 text-[12px] font-bold uppercase tracking-widest transition-colors',
        active
          ? 'border-primary text-slate-900'
          : 'border-transparent text-slate-500 hover:text-slate-800',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Link>
  )
}

function defaultHrefFor(cat: Category, ctx: NavContext): string | null {
  const first = cat.items.find((it) => it.show(ctx))
  return first?.href ?? null
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function labelForRole(role: string): string {
  switch (role) {
    case 'admin':
      return 'Administrador'
    case 'financeiro':
      return 'Financeiro'
    case 'recepcionista':
      return 'Recepção'
    case 'profissional_saude':
      return 'Profissional de Saúde'
    default:
      return role
  }
}
