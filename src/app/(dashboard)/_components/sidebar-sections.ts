/**
 * Feature 014 — fonte testável da configuração da sidebar. Separado do
 * componente React (`dashboard-shell.tsx`) para que vitest em `environment:
 * 'node'` consiga importar sem carregar React/Next.
 *
 * Mudanças desta feature em relação à versão anterior:
 *  - Operação: removidos Notificações, Alertas do sistema, Pendências.
 *  - Análise: removida Auditoria.
 *  - Configurações: colapsada para item único "Configurações" → /configuracoes
 *    (hub com cards filtrados por RBAC dentro da página).
 */
import {
  Calculator,
  Calendar,
  ClipboardCheck,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { Route } from 'next'
import { can } from '@/lib/auth/rbac'
import type { FeatureName } from '@/lib/feature-flags'
import type { Entitlements } from '@/lib/core/entitlements/plans'
import type { TenantRole } from '@/lib/db/types'

export interface NavContext {
  role: TenantRole
  flags: Record<FeatureName, boolean>
  /** Feature 031 — plano/módulos do tenant. */
  ent: Entitlements
}

export interface NavItem {
  href: Route
  label: string
  icon: LucideIcon
  show: (ctx: NavContext) => boolean
}

export interface NavSection {
  id: 'operacao' | 'analise' | 'configuracoes'
  label: string
  items: NavItem[]
}

export const SECTIONS: readonly NavSection[] = [
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
        href: '/operacao/tarefas',
        label: 'Tarefas',
        icon: ClipboardCheck,
        show: ({ role }) => can(role, 'task.read'),
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
        show: ({ role, flags, ent }) =>
          flags.relatorios && ent.has('relatorios') && can(role, 'report.read'),
      },
      {
        href: '/analise/comissoes',
        label: 'Comissões',
        icon: Calculator,
        show: ({ role, flags, ent }) =>
          flags.comissoes && ent.has('comissoes') && can(role, 'doctor.read'),
      },
      {
        href: '/analise/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        show: ({ role, ent }) =>
          ent.has('dashboard') && (role === 'admin' || role === 'financeiro'),
      },
      {
        href: '/analise/contas-a-receber',
        label: 'Contas a Receber',
        icon: Receipt,
        show: ({ role, ent }) =>
          ent.has('contas_receber') &&
          (role === 'admin' || role === 'financeiro' || role === 'recepcionista'),
      },
      {
        href: '/analise/contas-a-pagar',
        label: 'Contas a Pagar',
        icon: TrendingDown,
        show: ({ role, ent }) =>
          ent.has('contas_pagar') && (role === 'admin' || role === 'financeiro'),
      },
      {
        href: '/analise/fluxo-caixa',
        label: 'Fluxo de Caixa',
        icon: TrendingUp,
        show: ({ role, ent }) =>
          ent.has('fluxo_caixa') && (role === 'admin' || role === 'financeiro'),
      },
      {
        href: '/analise/repasse-medico',
        label: 'Repasse Médico',
        icon: Wallet,
        show: ({ role, ent }) =>
          ent.has('repasse') &&
          (role === 'admin' || role === 'financeiro' || role === 'profissional_saude'),
      },
      {
        href: '/analise/despesas',
        label: 'Despesas',
        icon: TrendingDown,
        show: ({ role, flags, ent }) => flags.despesas && ent.has('despesas') && role === 'admin',
      },
    ],
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    items: [
      {
        href: '/configuracoes',
        label: 'Configurações',
        icon: Settings,
        show: () => true,
      },
    ],
  },
]

export interface VisibleSection extends NavSection {
  visibleItems: NavItem[]
}

export function getVisibleSections(ctx: NavContext): VisibleSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    visibleItems: section.items.filter((it) => it.show(ctx)),
  })).filter((s) => s.visibleItems.length > 0)
}
