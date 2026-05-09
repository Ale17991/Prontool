'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Bell,
  Building2,
  Calculator,
  Calendar,
  ClipboardCheck,
  DollarSign,
  ListChecks,
  Lock,
  Menu,
  Plug,
  Receipt,
  ScrollText,
  Search,
  Stethoscope,
  TrendingDown,
  UserCheck,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { can } from '@/lib/auth/rbac'
import { listFeatureFlags, type FeatureName } from '@/lib/feature-flags'
import type { TenantRole } from '@/lib/db/types'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  SidebarIntegrationsBadge,
  type SidebarIntegrationBadgeItem,
} from './sidebar-integrations-badge'

/**
 * Feature 009 (US2) — sidebar reorganizada em 3 seções com itens
 * individuais clicáveis. Sem mais tab bar horizontal: cada item leva
 * direto à sua página.
 *
 * Visibilidade por item respeita a função do usuário via predicado `show`.
 * Itens onde nenhum role passa caem fora do render — uma seção sem itens
 * visíveis fica escondida.
 */

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  show: (ctx: NavContext) => boolean
}

interface NavSection {
  id: 'operacao' | 'analise' | 'configuracoes'
  label: string
  items: NavItem[]
}

interface NavContext {
  role: TenantRole
  flags: Record<FeatureName, boolean>
}

const SECTIONS: readonly NavSection[] = [
  {
    id: 'operacao',
    label: 'Operação',
    items: [
      {
        href: '/operacao/atendimentos',
        label: 'Agenda',
        icon: Calendar,
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
        label: 'Pendências',
        icon: AlertTriangle,
        show: ({ role }) => can(role, 'dlq.read'),
      },
    ],
  },
  {
    id: 'analise',
    label: 'Análise',
    items: [
      {
        href: '/analise/relatorios',
        label: 'Relatórios',
        icon: ScrollText,
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
    items: [
      {
        href: '/configuracoes/clinica',
        label: 'Clínica',
        icon: Building2,
        show: ({ role }) => role === 'admin',
      },
      {
        href: '/configuracoes/perfil',
        label: 'Meu Perfil',
        icon: UserCircle,
        show: () => true,
      },
      {
        href: '/configuracoes/usuarios',
        label: 'Usuários',
        icon: Users,
        show: ({ role }) => role === 'admin',
      },
      {
        href: '/configuracoes/procedimentos',
        label: 'Procedimentos',
        icon: ListChecks,
        show: ({ role }) => can(role, 'procedure.read'),
      },
      {
        href: '/configuracoes/convenios',
        label: 'Convênios',
        icon: DollarSign,
        show: ({ role }) => can(role, 'plan.read'),
      },
      {
        href: '/configuracoes/precos',
        label: 'Preços',
        icon: Receipt,
        show: ({ role }) => can(role, 'price.read'),
      },
      {
        href: '/configuracoes/profissionais',
        label: 'Profissionais',
        icon: UserCheck,
        show: ({ role }) => can(role, 'doctor.read'),
      },
      {
        href: '/configuracoes/modelos-anamnese',
        label: 'Modelos de Anamnese',
        icon: ClipboardCheck,
        show: ({ role, flags }) => flags.anamnese && role === 'admin',
      },
      {
        href: '/configuracoes/integracoes',
        label: 'Integrações',
        icon: Plug,
        show: ({ role }) => role === 'admin',
      },
    ],
  },
]

interface DashboardShellProps {
  role: TenantRole
  email: string | null
  integrations?: SidebarIntegrationBadgeItem[]
  /** Feature 009 — URL assinada da logo da clínica (24 h). null = fallback. */
  clinicLogoUrl?: string | null
  /** Feature 009 — razão social/nome fantasia. null = fallback "Prontool". */
  clinicName?: string | null
  children: ReactNode
}

export function DashboardShell({
  role,
  email,
  integrations = [],
  clinicLogoUrl = null,
  clinicName = null,
  children,
}: DashboardShellProps) {
  const pathname = usePathname() ?? ''
  const flags = listFeatureFlags()
  const ctx: NavContext = { role, flags }
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Calcula uma vez quais seções/itens aparecem para esta sessão.
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    visibleItems: section.items.filter((it) => it.show(ctx)),
  })).filter((s) => s.visibleItems.length > 0)

  // Heading do header global = label do item ativo.
  const activeItem = visibleSections
    .flatMap((s) => s.visibleItems)
    .find((it) => isUnder(pathname, it.href))

  const sidebarInner = (
    <SidebarInner
      sections={visibleSections}
      pathname={pathname}
      integrations={integrations}
      email={email}
      role={role}
      clinicLogoUrl={clinicLogoUrl}
      clinicName={clinicName}
      onNavigate={() => setDrawerOpen(false)}
    />
  )

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-100 font-sans">
      {/* Sidebar fixa (≥md) */}
      <aside className="z-20 hidden w-64 shrink-0 flex-col bg-slate-900 p-6 shadow-xl md:flex">
        {sidebarInner}
      </aside>

      {/* Drawer mobile (<md) */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          className="flex w-72 max-w-[80vw] flex-col bg-slate-900 p-6 sm:max-w-[80vw]"
        >
          <SheetTitle className="sr-only">Navegação</SheetTitle>
          {sidebarInner}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <header className="z-10 flex h-[72px] shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Abrir menu"
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">
              {activeItem?.label ?? 'Painel'}
            </h1>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar paciente, atendimento…"
                className="w-64 rounded-xl border border-slate-200 bg-slate-100 py-2 pl-10 pr-4 text-xs outline-none transition-all focus:border-primary/30 focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <button
              className="relative rounded-xl bg-slate-100 p-2.5 text-slate-500 transition-colors hover:bg-slate-200"
              aria-label="Notificações"
            >
              <Bell className="h-4 w-4" />
            </button>
            <div className="hidden h-6 w-px bg-slate-200 md:block" />
            <Link
              href="/login"
              className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
              title="Sair"
            >
              <Lock className="h-3 w-3" />
              <span className="hidden sm:inline">Sair</span>
            </Link>
          </div>
        </header>

        {/* Feature 009 — barra de abas horizontais REMOVIDA. Cada item da
            sidebar leva direto à página final. */}

        <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
      </main>
    </div>
  )
}

interface VisibleSection extends NavSection {
  visibleItems: NavItem[]
}

function SidebarInner({
  sections,
  pathname,
  integrations,
  email,
  role,
  clinicLogoUrl,
  clinicName,
  onNavigate,
}: {
  sections: VisibleSection[]
  pathname: string
  integrations: SidebarIntegrationBadgeItem[]
  email: string | null
  role: TenantRole
  clinicLogoUrl: string | null
  clinicName: string | null
  onNavigate: () => void
}) {
  return (
    <>
      <div className="mb-8 flex items-center gap-3 text-base font-bold text-white">
        {clinicLogoUrl ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={clinicLogoUrl} alt="Logo da clínica" className="h-full w-full object-contain" />
          </div>
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary">
            <Stethoscope className="h-5 w-5 text-white" />
          </div>
        )}
        <span className="truncate tracking-tight">{clinicName ?? 'Prontool'}</span>
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.id}>
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {section.label}
            </div>
            <div className="flex flex-col gap-1">
              {section.visibleItems.map((it) => (
                <SidebarLink
                  key={it.href}
                  href={it.href}
                  label={it.label}
                  icon={it.icon}
                  active={isUnder(pathname, it.href)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-white/5 pt-6">
        <SidebarIntegrationsBadge integrations={integrations} />
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
    </>
  )
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string
  label: string
  icon: LucideIcon
  active: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      href={href as never}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200',
        active
          ? 'bg-primary/15 text-white shadow-inner ring-1 ring-primary/30'
          : 'text-slate-400 hover:bg-white/5 hover:text-white',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-slate-500')} />
      <span className="truncate">{label}</span>
    </Link>
  )
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
