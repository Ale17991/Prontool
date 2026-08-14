import {
  Apple,
  BellRing,
  Wand2,
  Boxes,
  Building2,
  CalendarPlus,
  ClipboardCheck,
  DollarSign,
  FileText,
  HeartPulse,
  ListChecks,
  Plug,
  Printer,
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
  | 'materiais'
  | 'alimentos'
  | 'convenios'
  | 'profissionais'
  | 'modelos-anamnese'
  | 'modelos-documento'
  | 'impressos'
  | 'agendamento-publico'
  | 'portal-paciente'
  | 'lembretes'
  | 'automacoes'
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
    id: 'materiais',
    href: '/configuracoes/materiais',
    title: 'Materiais / Insumos',
    description: 'Catálogo de insumos e custos usados nos atendimentos.',
    icon: Boxes,
    show: ({ role }) => role === 'admin' || role === 'financeiro',
  },
  {
    id: 'alimentos',
    href: '/configuracoes/alimentos',
    title: 'Alimentos',
    description: 'Base de alimentos (TACO/IBGE) e cadastro dos alimentos da clínica.',
    icon: Apple,
    show: ({ role, ent }) =>
      ent.hasModule('dieta') && (role === 'admin' || role === 'profissional_saude'),
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
    // A tela existia desde a 0141 mas só era alcançável por um link dentro da
    // ficha do paciente — quem nunca emitiu documento não sabia que havia
    // biblioteca de modelos.
    id: 'modelos-documento',
    href: '/configuracoes/modelos-documento',
    title: 'Modelos de Documento',
    description: 'Atestados, declarações e termos reutilizáveis, com variáveis do paciente.',
    icon: FileText,
    show: ({ role }) => role === 'admin' || role === 'profissional_saude',
  },
  {
    id: 'impressos',
    href: '/configuracoes/impressos',
    title: 'Impressos',
    description: 'Quais dados do paciente aparecem nos documentos impressos.',
    icon: Printer,
    show: ({ role }) => role === 'admin',
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
  // A conexão do número de WhatsApp NÃO tem card próprio: ela mora dentro desta
  // tela. Vincular o número só existe para servir o lembrete, e dois cards
  // faziam a clínica configurar o canal num lugar e descobrir no outro que
  // faltava conectar. O RBAC mais restrito de `whatsapp.config` continua
  // valendo lá dentro, na seção.
  // O card só aparece para quem NÃO tem o módulo de automações. Quem tem entra
  // pela tela de Automações, onde o lembrete virou uma área secundária: são duas
  // formas de a clínica mandar mensagem, e dois cards lado a lado obrigavam a
  // adivinhar em qual delas estava o que se procura.
  //
  // A condição não é firula de arrumação. Esta tela é o ÚNICO lugar onde se
  // conecta o número de WhatsApp da clínica (ver o comentário acima), e a maior
  // parte das clínicas não contratou automações — escondê-la sem a condição
  // deixaria essas clínicas sem como vincular o número nem configurar lembrete.
  {
    id: 'lembretes',
    href: '/configuracoes/lembretes',
    title: 'Lembretes automáticos',
    description: 'Avisa o paciente por email ou WhatsApp antes da consulta. Reduz no-show.',
    icon: BellRing,
    show: ({ role, ent }) => can(role, 'reminders.config') && !ent.hasModule('automacoes'),
  },
  // Card PRÓPRIO, e não uma seção dentro de Lembretes: o lembrete de consulta
  // tem motor e configuração próprios (056 FR-024), e o construtor cobre as
  // outras mensagens. A hierarquia é a inversa da que se pensou no começo — é o
  // lembrete que virou área dentro das automações, e não o contrário.
  {
    id: 'automacoes',
    href: '/configuracoes/automacoes',
    title: 'Automações de mensagem',
    description: 'Monte o gatilho e a mensagem: aniversário, hábitos, retorno.',
    icon: Wand2,
    show: ({ role, ent }) => ent.hasModule('automacoes') && can(role, 'reminders.config'),
  },
  // Sem card de Google Agenda: a conexão mora no CADASTRO DO PROFISSIONAL
  // (/configuracoes/profissionais/[id]), e não numa tela de conta. Cada médico
  // tem a sua própria agenda, e é lá que se vê de quem é a que está conectada —
  // ao lado do vínculo com usuário, que é pré-requisito do sync.
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
