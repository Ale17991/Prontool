'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, LayoutDashboard, LifeBuoy, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/admin', label: 'Visão geral', icon: LayoutDashboard, exact: true },
  { href: '/admin/clinicas', label: 'Clínicas & planos', icon: Building2, exact: false },
  { href: '/admin/suporte', label: 'Equipe de suporte', icon: LifeBuoy, exact: false },
  { href: '/admin/usuarios', label: 'Usuários', icon: Users, exact: false },
] as const

export function AdminNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav className="w-52 shrink-0 space-y-1">
      {ITEMS.map((it) => {
        const active = it.exact ? pathname === it.href : pathname.startsWith(it.href)
        const Icon = it.icon
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {it.label}
          </Link>
        )
      })}
    </nav>
  )
}
