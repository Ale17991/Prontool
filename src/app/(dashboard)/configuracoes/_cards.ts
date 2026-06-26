import {
  BellRing,
  Building2,
  CalendarClock,
  CalendarPlus,
  ClipboardCheck,
  DollarSign,
  HeartPulse,
  ListChecks,
  Plug,
  ScrollText,
  UserCheck,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Route } from 'next'
import { can } from '@/lib/auth/rbac'
import type { FeatureName } from '@/lib/feature-flags'
import type { Entitlements } from '@/lib/core/entitlements/plans'
import type { TenantRole } from '@/lib/db/types'

/**
 * Feature 014 — US3 — fonte de verdade dos cards do hub /configuracoes.
 * Server-only (não há razão para enviar a tabela inteira ao cliente).
 *
 * Ordem aqui é a ordem renderizada (FR-009). Auditoria sempre no final.
 * Os predicados `show` espelham exatamente os predicados que estavam em
 * `dashboard-shell.tsx` antes desta feature, para evitar drift de RBAC.
 */

export type HubCardId =
  | 'clinica'
  | 'perfil'
  | 'usuarios'
  | 'procedimentos'
  | 'convenios'
  | 'profissionais'
  | 'modelos-anamnese'
  | 'agendamento-publico'
  | 'portal-paciente'
  | 'lembretes'
  | 'google-agenda'
  | 'integracoes'
  | 'auditoria'

export interface HubCardCtx {
  role: TenantRole
  flags: Record<FeatureName, boolean>
  /** Feature 031 — plano/módulos do tenant. */
  ent: Entitlements
}

export interface HubCardDef {
  id: HubCardId
  href: Route
  title: string
  description: string
  icon: LucideIcon
  show: (ctx: HubCardCtx) => boolean
}

export const HUB_CARDS: readonly HubCardDef[] = [
  {
    id: 'clinica',
    href: '/configuracoes/clinica',
    title: 'Clínica',
    description: 'Dados, logo e identidade visual da clínica.',
    icon: Building2,
    show: ({ role }) => role === 'admin',
  },
  {
    id: 'perfil',
    href: '/configuracoes/perfil',
    title: 'Meu Perfil',
    description: 'Seus dados pessoais, avatar e preferências.',
    icon: UserCircle,
    show: () => true,
  },
  {
    id: 'usuarios',
    href: '/configuracoes/usuarios',
    title: 'Usuários',
    description: 'Convide e gerencie quem tem acesso à clínica.',
    icon: Users,
    show: ({ role }) => role === 'admin',
  },
  {
    id: 'procedimentos',
    href: '/configuracoes/procedimentos',
    title: 'Procedimentos',
    description: 'Catálogo de procedimentos e códigos TUSS.',
    icon: ListChecks,
    show: ({ role }) => can(role, 'procedure.read'),
  },
  {
    id: 'convenios',
    href: '/configuracoes/convenios',
    title: 'Convênios',
    description: 'Convênios atendidos e tabelas de preço.',
    icon: DollarSign,
    show: ({ role, ent }) => ent.hasModule('convenio') && can(role, 'plan.read'),
  },
  {
    id: 'profissionais',
    href: '/configuracoes/profissionais',
    title: 'Profissionais',
    description: 'Profissionais de saúde e comissões.',
    icon: UserCheck,
    show: ({ role }) => can(role, 'doctor.read'),
  },
  {
    id: 'modelos-anamnese',
    href: '/configuracoes/modelos-anamnese',
    title: 'Modelos de Anamnese',
    description: 'Modelos clínicos reutilizáveis nos atendimentos.',
    icon: ClipboardCheck,
    show: ({ role, flags, ent }) => flags.anamnese && ent.has('anamnese') && role === 'admin',
  },
  {
    id: 'agendamento-publico',
    href: '/configuracoes/agendamento-publico',
    title: 'Agendamento online',
    description: 'Link público pra paciente marcar consulta sem login.',
    icon: CalendarPlus,
    show: ({ role }) => can(role, 'public_booking.config'),
  },
  {
    id: 'portal-paciente',
    href: '/configuracoes/portal-paciente',
    title: 'Portal do paciente',
    description: 'Paciente acompanha evolução e métricas; defina o que aparece.',
    icon: HeartPulse,
    show: ({ role, ent }) => ent.hasModule('portal_paciente') && can(role, 'patient_portal.config'),
  },
  {
    id: 'lembretes',
    href: '/configuracoes/lembretes',
    title: 'Lembretes automáticos',
    description: 'Envia email antes da consulta. Reduz no-show.',
    icon: BellRing,
    show: ({ role }) => can(role, 'reminders.config'),
  },
  {
    id: 'google-agenda',
    href: '/configuracoes/google-agenda',
    title: 'Google Agenda',
    description: 'Conecte sua conta Google: seus atendimentos entram na agenda pessoal.',
    icon: CalendarClock,
    show: () => true,
  },
  {
    id: 'integracoes',
    href: '/configuracoes/integracoes',
    title: 'Integrações',
    description: 'Conexões com WhatsApp, Homio e outros sistemas.',
    icon: Plug,
    show: ({ role }) => role === 'admin',
  },
  {
    id: 'auditoria',
    href: '/configuracoes/auditoria',
    title: 'Auditoria',
    description: 'Trilha completa de alterações e acessos sensíveis.',
    icon: ScrollText,
    show: ({ role, ent }) => ent.has('auditoria') && can(role, 'audit.read'),
  },
]

export function getVisibleHubCards(ctx: HubCardCtx): HubCardDef[] {
  return HUB_CARDS.filter((c) => c.show(ctx))
}
