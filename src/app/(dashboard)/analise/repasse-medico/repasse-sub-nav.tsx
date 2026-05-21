import Link from 'next/link'
import { CalendarRange, Stethoscope } from 'lucide-react'
import { cn } from '@/lib/utils'

type TabKey = 'mensal' | 'por-profissional'

interface Tab {
  key: TabKey
  href: string
  label: string
  icon: typeof CalendarRange
}

const TABS: Tab[] = [
  {
    key: 'mensal',
    href: '/analise/repasse-medico',
    label: 'Mensal',
    icon: CalendarRange,
  },
  {
    key: 'por-profissional',
    href: '/analise/repasse-medico/por-profissional',
    label: 'Por profissional',
    icon: Stethoscope,
  },
]

export function RepasseSubNav({ active }: { active: TabKey }) {
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
