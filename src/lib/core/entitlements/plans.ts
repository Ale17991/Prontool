/**
 * Feature 031 — matriz de planos → features e catálogo de módulos.
 *
 * Puro (sem deps de servidor) — importável tanto no servidor quanto no
 * cliente (o dashboard-shell reconstrói o checker a partir do plano+módulos
 * serializados). A fonte da verdade do "o que cada plano inclui" é AQUI; o
 * banco (tenant_entitlements) guarda só plano, status e módulos contratados.
 */

export type Plan = 'essencial' | 'pro' | 'clinica' | 'legacy'

export type ModuleId =
  | 'convenio'
  | 'odonto'
  | 'oftalmo'
  | 'portal_paciente'
  | 'telemedicina'
  | 'crm'
  | 'treino'
  | 'dieta'
  | 'endocrino'
  // Nutrição (feature em construção — o /admin já liga/desliga por clínica;
  // cada função é gated pelo respectivo módulo à medida que for entregue).
  | 'nutri_avaliacao' // antropometria/dobras + gasto energético (TMB/GET) + metas
  | 'nutri_recordatorio' // recordatório alimentar (R24h)
  | 'nutri_rotulo' // rótulo nutricional
  | 'exames_lab' // exames laboratoriais com faixas (cross-especialidade)
  | 'whatsapp' // canal WhatsApp nos lembretes (051) — rollout por clínica
  | 'habitos' // checklist de hábitos marcado pelo paciente (cross-especialidade)
  // Prescrição digital Memed. NÃO é só "liga a tela": marca a clínica como
  // PRESCRITORA, e isso muda quais dados do paciente são obrigatórios em todo
  // lugar que cadastra paciente (ver core/patients/required-fields.ts).
  | 'memed'

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
  'convenio',
  'odonto',
  'oftalmo',
  'portal_paciente',
  'telemedicina',
  'crm',
  'treino',
  'dieta',
  'endocrino',
  'nutri_avaliacao',
  'nutri_recordatorio',
  'nutri_rotulo',
  'exames_lab',
  'whatsapp',
  'habitos',
  'memed',
]

export const MODULE_LABEL: Record<ModuleId, string> = {
  convenio: 'Convênio / TISS',
  odonto: 'Odontograma',
  oftalmo: 'Oftalmologia',
  portal_paciente: 'Portal do paciente',
  telemedicina: 'Telemedicina',
  crm: 'CRM',
  treino: 'Treino',
  dieta: 'Plano alimentar',
  endocrino: 'Endócrino',
  nutri_avaliacao: 'Avaliação nutricional',
  nutri_recordatorio: 'Recordatório alimentar',
  nutri_rotulo: 'Rótulo nutricional',
  exames_lab: 'Exames laboratoriais',
  whatsapp: 'WhatsApp (lembretes)',
  habitos: 'Checklist de hábitos',
  memed: 'Prescrição digital (Memed)',
}

/** Uma linha explicando o que a clínica ganha — o /admin mostra ao lado. */
export const MODULE_HINT: Record<ModuleId, string> = {
  convenio: 'Faturamento TISS, guias e lotes para operadoras.',
  odonto: 'Odontograma interativo e periograma.',
  oftalmo: 'Exames e laudos oftalmológicos.',
  portal_paciente: 'Área do paciente com histórico e medições.',
  telemedicina: 'Atendimento por vídeo.',
  crm: 'Funil e integrações de captação.',
  treino: 'Prescrição de treino.',
  dieta: 'Montagem e prescrição de plano alimentar.',
  endocrino: 'Acompanhamento endocrinológico e curvas.',
  nutri_avaliacao: 'Antropometria, dobras, TMB/GET e metas.',
  nutri_recordatorio: 'Recordatório alimentar de 24h e adequação.',
  nutri_rotulo: 'Tabela nutricional de embalagem (IN 75/2020).',
  exames_lab: 'Resultados de exames com faixas de referência.',
  whatsapp: 'Lembrete de consulta pelo WhatsApp da clínica.',
  habitos: 'Checklist de hábitos marcado pelo paciente.',
  memed: 'Receituário digital assinado, com validade legal.',
}

export interface ModuleBlock {
  id: string
  label: string
  /** Por que este bloco existe / para quem é. */
  hint: string
  modules: ModuleId[]
}

/**
 * Catálogo agrupado — como o /admin apresenta os módulos. Cada bloco liga/
 * desliga inteiro OU item a item; a granularidade real continua sendo o
 * módulo individual (o bloco é só um atalho de UI).
 *
 * INVARIANTE: todo ModuleId aparece em exatamente um bloco (coberto por teste).
 */
export const MODULE_BLOCKS: readonly ModuleBlock[] = [
  {
    id: 'geral',
    label: 'Geral',
    hint: 'Serve a qualquer especialidade.',
    modules: ['crm', 'portal_paciente', 'whatsapp', 'habitos', 'exames_lab', 'convenio'],
  },
  {
    id: 'prescricao',
    label: 'Prescrição',
    hint: 'Marca a clínica como prescritora — muda os dados obrigatórios do paciente.',
    modules: ['memed', 'telemedicina'],
  },
  {
    id: 'odontologia',
    label: 'Odontologia',
    hint: 'Consultório odontológico.',
    modules: ['odonto'],
  },
  {
    id: 'oftalmologia',
    label: 'Oftalmologia',
    hint: 'Consultório oftalmológico.',
    modules: ['oftalmo'],
  },
  {
    id: 'nutricao',
    label: 'Nutrição',
    hint: 'Consultório de nutrição — vendidos separadamente.',
    modules: ['nutri_avaliacao', 'dieta', 'nutri_recordatorio', 'nutri_rotulo'],
  },
  {
    id: 'endocrinologia',
    label: 'Endocrinologia',
    hint: 'Acompanhamento endócrino.',
    modules: ['endocrino'],
  },
  {
    id: 'educacao_fisica',
    label: 'Educação física',
    hint: 'Prescrição de treino.',
    modules: ['treino'],
  },
]

/**
 * Módulos "em breve": aparecem no catálogo/UI mas ainda NÃO são contratáveis
 * (sem produto por trás). O painel /admin mostra desabilitado e a action não
 * persiste. Hoje: telemedicina (só flag, sem implementação).
 */
export const COMING_SOON_MODULES: readonly ModuleId[] = ['telemedicina']

/**
 * Módulos que NUNCA chegam por grandfather/fail-open — só por marcação
 * explícita no /admin.
 *
 * `memed` está aqui porque ligá-lo não abre uma tela a mais: ele endurece os
 * campos obrigatórios do paciente em toda a clínica, inclusive no agendamento
 * público. Herdar isso de uma linha ausente em `tenant_entitlements` faria uma
 * recepção parar de conseguir cadastrar paciente por causa de um erro
 * transitório de leitura. Restrição de cadastro se assume, não se herda.
 */
export const EXPLICIT_ONLY_MODULES: readonly ModuleId[] = ['memed']

const ESSENCIAL: Feature[] = [
  'agenda',
  'pacientes',
  'prontuario',
  'anamnese',
  'prescricao',
  'cadastros',
  'agendamento_publico',
  'lembretes_email',
  'tarefas',
]
const PRO: Feature[] = [
  ...ESSENCIAL,
  'financeiro',
  'contas_receber',
  'contas_pagar',
  'fluxo_caixa',
  'repasse',
  'comissoes',
  'relatorios',
  'despesas',
  'dashboard',
  'lembretes_whatsapp',
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
  if (plan === 'clinica') mods.add('crm')
  // 'legacy' = grandfather, mas a lista é AUTORITATIVA quando preenchida: o
  // /admin liga/desliga módulos por clínica e o desativado some de fato.
  // Defensivo: lista VAZIA (clínica nunca backfillada) ⇒ acesso total, para
  // nenhuma clínica antiga perder acesso por falta de backfill (migração 0164
  // popula as legadas com o conjunto completo; daí o admin desativa o que quiser).
  if (plan === 'legacy' && modules.length === 0) {
    for (const m of ALL_MODULES) {
      if (!EXPLICIT_ONLY_MODULES.includes(m)) mods.add(m)
    }
  }
  const featureSet = new Set<Feature>(features)
  return {
    plan,
    features,
    modules: [...mods],
    has: (f) => featureSet.has(f),
    hasModule: (m) => mods.has(m),
  }
}
