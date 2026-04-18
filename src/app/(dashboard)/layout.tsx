import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  Bell,
  Calculator,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  Lock,
  Search,
  Stethoscope,
  TrendingDown,
  UserCheck,
  Users,
  AlertTriangle,
  ListChecks,
  ScrollText,
  DollarSign,
} from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { listFeatureFlags } from '@/lib/feature-flags'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const flags = listFeatureFlags()

  const navSections: Array<{
    label: string
    items: Array<{ href: string; label: string; icon: typeof LayoutDashboard; show: boolean }>
  }> = [
    {
      label: 'Operação',
      items: [
        {
          href: '/atendimentos',
          label: 'Atendimentos',
          icon: Stethoscope,
          show: can(session.role, 'appointment.read'),
        },
        {
          href: '/pacientes',
          label: 'Pacientes',
          icon: Users,
          show: can(session.role, 'appointment.read'),
        },
        {
          href: '/alertas',
          label: 'Alertas',
          icon: Bell,
          show: can(session.role, 'alert.read'),
        },
        {
          href: '/dlq',
          label: 'Fila de erros',
          icon: AlertTriangle,
          show: can(session.role, 'dlq.read'),
        },
      ],
    },
    {
      label: 'Cadastros',
      items: [
        {
          href: '/precos',
          label: 'Preços',
          icon: DollarSign,
          show: can(session.role, 'price.read'),
        },
        {
          href: '/procedimentos',
          label: 'Procedimentos',
          icon: ListChecks,
          show: can(session.role, 'procedure.read'),
        },
        {
          href: '/planos',
          label: 'Planos',
          icon: FileText,
          show: can(session.role, 'plan.read'),
        },
        {
          href: '/medicos',
          label: 'Médicos',
          icon: UserCheck,
          show: can(session.role, 'doctor.read'),
        },
      ],
    },
    {
      label: 'Análise',
      items: [
        {
          href: '/relatorios',
          label: 'Relatórios',
          icon: LayoutDashboard,
          show: flags.relatorios && can(session.role, 'report.read'),
        },
        {
          href: '/comissoes',
          label: 'Comissões',
          icon: Calculator,
          show: can(session.role, 'doctor.read'),
        },
        {
          href: '/despesas',
          label: 'Despesas',
          icon: TrendingDown,
          show: flags.despesas && session.role === 'admin',
        },
        {
          href: '/anamnese',
          label: 'Modelos de Anamnese',
          icon: ClipboardCheck,
          show: flags.anamnese && session.role === 'admin',
        },
        {
          href: '/auditoria',
          label: 'Auditoria',
          icon: ScrollText,
          show: can(session.role, 'audit.read'),
        },
      ],
    },
  ]

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-100 font-sans">
      <aside className="z-20 flex w-64 shrink-0 flex-col bg-slate-900 p-6 shadow-xl">
        <div className="mb-10 flex items-center gap-3 text-xl font-bold text-white">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary">
            <Stethoscope className="h-5 w-5 text-white" />
          </div>
          <span className="tracking-tight">Homio Faturamento</span>
        </div>

        <nav className="flex flex-1 flex-col gap-6 overflow-y-auto">
          {navSections.map((section) => {
            const visible = section.items.filter((it) => it.show)
            if (visible.length === 0) return null
            return (
              <div key={section.label} className="flex flex-col gap-1.5">
                <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {section.label}
                </p>
                {visible.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-[13px] font-medium text-slate-400 transition-all duration-200 hover:bg-white/5 hover:text-white"
                  >
                    <item.icon className="h-4 w-4 text-slate-500" />
                    {item.label}
                  </Link>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="mt-auto border-t border-white/5 pt-6">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2 text-slate-400">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-slate-800 text-xs font-bold uppercase text-white">
              {session.email?.slice(0, 1) ?? '?'}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-xs font-semibold text-white">{session.email ?? '—'}</p>
              <p className="truncate text-[10px] text-slate-500">
                {labelForRole(session.role)}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <header className="z-10 flex h-[72px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-8 shadow-sm">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">Painel</h1>
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

        <div className="flex-1 overflow-y-auto p-8">{children}</div>
      </main>
    </div>
  )
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
