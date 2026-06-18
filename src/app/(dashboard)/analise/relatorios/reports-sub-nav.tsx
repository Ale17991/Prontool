import Link from 'next/link'
import { Grid3x3, LayoutDashboard, ShieldCheck, Stethoscope } from 'lucide-react'
import { cn } from '@/lib/utils'

type TabKey = 'dashboard' | 'por-plano' | 'por-profissional' | 'medico-plano'

interface Tab {
  key: TabKey
  href: string
  label: string
  icon: typeof LayoutDashboard
}

const TABS: Tab[] = [
  {
    key: 'dashboard',
    href: '/analise/relatorios',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    key: 'por-plano',
    href: '/analise/relatorios/por-plano',
    label: 'Por plano',
    icon: ShieldCheck,
  },
  {
    key: 'por-profissional',
    href: '/analise/relatorios/por-profissional',
    label: 'Por profissional',
    icon: Stethoscope,
  },
  {
    key: 'medico-plano',
    href: '/analise/relatorios/medico-plano',
    label: 'Médico × plano',
    icon: Grid3x3,
  },
]

export function ReportsSubNav({ active }: { active: TabKey }) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1 text-[11px] font-bold uppercase tracking-widest">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = tab.key === active
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors',
              isActive
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            <Icon className="h-3 w-3" />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
