/**
 * Feature 031 — matriz de planos → features e catálogo de módulos.
 *
 * Puro (sem deps de servidor) — importável tanto no servidor quanto no
 * cliente (o dashboard-shell reconstrói o checker a partir do plano+módulos
 * serializados). A fonte da verdade do "o que cada plano inclui" é AQUI; o
 * banco (tenant_entitlements) guarda só plano, status e módulos contratados.
 */

export type Plan = 'essencial' | 'pro' | 'clinica' | 'legacy'

export type ModuleId = 'tiss' | 'portal_paciente' | 'telemedicina' | 'crm'

export type Feature =
  // núcleo (Essencial)
  | 'agenda'
  | 'pacientes'
  | 'prontuario'
  | 'anamnese'
  | 'prescricao'
  | 'cadastros'
  | 'agendamento_publico'
  | 'lembretes_email'
  | 'tarefas'
  // Pro
  | 'financeiro'
  | 'contas_receber'
  | 'contas_pagar'
  | 'fluxo_caixa'
  | 'repasse'
  | 'comissoes'
  | 'relatorios'
  | 'despesas'
  | 'dashboard'
  | 'lembretes_whatsapp'
  // Clínica
  | 'multiunidade'
  | 'auditoria'
  | 'bi'

export const ALL_MODULES: readonly ModuleId[] = [
  'tiss',
  'portal_paciente',
  'telemedicina',
  'crm',
]

const ESSENCIAL: Feature[] = [
  'agenda', 'pacientes', 'prontuario', 'anamnese', 'prescricao', 'cadastros',
  'agendamento_publico', 'lembretes_email', 'tarefas',
]
const PRO: Feature[] = [
  ...ESSENCIAL,
  'financeiro', 'contas_receber', 'contas_pagar', 'fluxo_caixa', 'repasse',
  'comissoes', 'relatorios', 'despesas', 'dashboard', 'lembretes_whatsapp',
]
const CLINICA: Feature[] = [...PRO, 'multiunidade', 'auditoria', 'bi']

export const PLAN_FEATURES: Record<Plan, Feature[]> = {
  essencial: ESSENCIAL,
  pro: PRO,
  clinica: CLINICA,
  legacy: CLINICA, // legado = tudo
}

export const PLAN_LABEL: Record<Plan, string> = {
  essencial: 'Essencial',
  pro: 'Pro',
  clinica: 'Clínica',
  legacy: 'Legado',
}

export interface Entitlements {
  plan: Plan
  /** Features baseline do plano. */
  features: Feature[]
  /** Módulos add-on efetivos (inclui 'crm' embutido no Clínica/Legado). */
  modules: ModuleId[]
  has(feature: Feature): boolean
  hasModule(moduleId: ModuleId): boolean
}

/**
 * Monta o objeto de checagem a partir do plano + módulos contratados.
 * Usado no servidor (após ler o banco) e no cliente (a partir do prop
 * serializado). 'crm' é incluído automaticamente em Clínica/Legado.
 */
export function buildEntitlements(plan: Plan, modules: ModuleId[]): Entitlements {
  const features = PLAN_FEATURES[plan] ?? PLAN_FEATURES.essencial
  const mods = new Set<ModuleId>(modules)
  if (plan === 'clinica' || plan === 'legacy') mods.add('crm')
  const featureSet = new Set<Feature>(features)
  return {
    plan,
    features,
    modules: [...mods],
    has: (f) => featureSet.has(f),
    hasModule: (m) => mods.has(m),
  }
}
