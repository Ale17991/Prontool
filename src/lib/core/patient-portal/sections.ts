/**
 * Feature 032 — catálogo de seções do Portal do Paciente + resolver de visibilidade.
 *
 * Fonte da verdade das seções (chaves, default, sensibilidade, módulo exigido)
 * vive AQUI (como o catálogo de planos da 031). A tabela `tenant_portal_sections`
 * guarda só o override por clínica.
 *
 * Três camadas de controle (ver docs/spec-portal-paciente-modular.md):
 *   1. plano/módulo (entitlements 031) — via callback `hasModule` opcional;
 *   2. override da clínica (tabela) — liga/desliga;
 *   3. cautela clínica — seções sensíveis nascem OFF por padrão (CFM Art. 34/88).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export type PortalSectionKey =
  | 'metas'
  | 'atendimentos'
  | 'metricas'
  | 'orientacoes'
  | 'prescricoes'
  | 'documentos'
  | 'exames'
  | 'vacinas'
  | 'faturas'
  | 'treino'
  | 'dieta'

export type SectionSensitivity = 'baixa' | 'media' | 'alta'

/** Módulos pagos (entitlements 031) que algumas seções exigem. */
export type PortalSectionModule = 'treino' | 'dieta' | 'telemedicina'

export interface PortalSectionDef {
  key: PortalSectionKey
  label: string
  description: string
  /** Default quando a clínica não definiu override. Sensíveis nascem `false`. */
  defaultEnabled: boolean
  sensitivity: SectionSensitivity
  /** Módulo pago exigido pelo plano. `undefined` = não exige plano. */
  requiredModule?: PortalSectionModule
  /** Já renderiza no painel do paciente. `false` = "Em breve" (switch desabilitado). */
  implemented: boolean
  order: number
}

export const PORTAL_SECTIONS: readonly PortalSectionDef[] = [
  {
    key: 'metas',
    label: 'Minhas metas',
    description: 'Metas de saúde definidas pela equipe (peso, glicemia, etc.) com progresso.',
    defaultEnabled: true,
    sensitivity: 'baixa',
    implemented: true,
    order: 5,
  },
  {
    key: 'atendimentos',
    label: 'Meus atendimentos',
    description: 'Histórico de consultas e atendimentos.',
    defaultEnabled: true,
    sensitivity: 'baixa',
    implemented: true,
    order: 10,
  },
  {
    key: 'metricas',
    label: 'Minha evolução',
    description: 'Peso, IMC e métricas de acompanhamento, com tendência.',
    defaultEnabled: true,
    sensitivity: 'baixa',
    implemented: true,
    order: 20,
  },
  {
    key: 'orientacoes',
    label: 'Orientações',
    description: 'Orientações e plano de cuidado escritos pela equipe.',
    defaultEnabled: false,
    sensitivity: 'media',
    implemented: true,
    order: 30,
  },
  {
    key: 'prescricoes',
    label: 'Prescrições',
    description: 'Receitas e prescrições digitais.',
    defaultEnabled: false,
    sensitivity: 'media',
    implemented: false,
    order: 40,
  },
  {
    key: 'documentos',
    label: 'Documentos',
    description: 'Atestados, laudos e declarações.',
    defaultEnabled: false,
    sensitivity: 'media',
    implemented: false,
    order: 50,
  },
  {
    key: 'exames',
    label: 'Resultados de exames',
    description: 'Resultados com interpretação (nunca o valor cru isolado).',
    defaultEnabled: false,
    sensitivity: 'alta',
    implemented: false,
    order: 60,
  },
  {
    key: 'vacinas',
    label: 'Vacinas',
    description: 'Carteira de vacinação.',
    defaultEnabled: false,
    sensitivity: 'baixa',
    implemented: false,
    order: 70,
  },
  {
    key: 'faturas',
    label: 'Faturas',
    description: 'Pagamentos e faturas da clínica.',
    defaultEnabled: false,
    sensitivity: 'baixa',
    implemented: false,
    order: 80,
  },
  {
    key: 'treino',
    label: 'Rotina de treino',
    description: 'Treino prescrito pelo profissional.',
    defaultEnabled: false,
    sensitivity: 'baixa',
    requiredModule: 'treino',
    implemented: true,
    order: 90,
  },
  {
    key: 'dieta',
    label: 'Plano alimentar',
    description: 'Dieta prescrita pelo nutricionista.',
    defaultEnabled: false,
    sensitivity: 'media',
    requiredModule: 'dieta',
    implemented: true,
    order: 100,
  },
]

const BY_KEY = new Map<string, PortalSectionDef>(PORTAL_SECTIONS.map((s) => [s.key, s]))

export function isPortalSectionKey(key: string): key is PortalSectionKey {
  return BY_KEY.has(key)
}

export interface ResolvedSection extends PortalSectionDef {
  /** Liberada pelo plano da clínica (módulo contratado ou não exige). */
  allowedByPlan: boolean
  /** Override da clínica (true/false) ou null quando não definido. */
  clinicOverride: boolean | null
  /** Visível ao paciente = liberada pelo plano E (override ?? default). */
  enabled: boolean
}

export interface ResolveSectionsOpts {
  /** Checker do entitlement (031). Ausente ⇒ módulos pagos indisponíveis. */
  hasModule?: (module: PortalSectionModule) => boolean
}

/**
 * Resolve TODAS as seções com seu estado (para a tela admin de configuração).
 * Ordenadas por `order`.
 */
export async function resolvePortalSections(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opts: ResolveSectionsOpts = {},
): Promise<ResolvedSection[]> {
  // Tabela nova (0115) ainda não tipada nos generated types → cliente solto.
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('tenant_portal_sections')
    .select('section_key, enabled')
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`resolvePortalSections: ${error.message}`)

  const overrides = new Map<string, boolean>(
    ((data ?? []) as Array<{ section_key: string; enabled: boolean }>).map((r) => [
      r.section_key,
      r.enabled,
    ]),
  )
  const hasModule = opts.hasModule ?? (() => false)

  return [...PORTAL_SECTIONS]
    .sort((a, b) => a.order - b.order)
    .map((def) => {
      const allowedByPlan = def.requiredModule ? hasModule(def.requiredModule) : true
      const clinicOverride = overrides.has(def.key) ? overrides.get(def.key)! : null
      const enabled = allowedByPlan && (clinicOverride ?? def.defaultEnabled)
      return { ...def, allowedByPlan, clinicOverride, enabled }
    })
}

/** Liga/desliga uma seção para a clínica (upsert idempotente). Admin-only no caller. */
export async function setPortalSection(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sectionKey: string,
  enabled: boolean,
): Promise<void> {
  if (!isPortalSectionKey(sectionKey)) {
    throw new Error(`setPortalSection: seção desconhecida "${sectionKey}"`)
  }
  // O gate de plano (módulo) é aplicado no resolver; aqui só guardamos o override.
  const { error } = await (supabase as unknown as SupabaseClient)
    .from('tenant_portal_sections')
    .upsert(
      { tenant_id: tenantId, section_key: sectionKey, enabled },
      { onConflict: 'tenant_id,section_key' },
    )
  if (error) throw new Error(`setPortalSection: ${error.message}`)
}

/** Apenas as chaves das seções visíveis ao paciente (para o painel). */
export async function listEnabledPortalSections(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opts: ResolveSectionsOpts = {},
): Promise<PortalSectionKey[]> {
  const all = await resolvePortalSections(supabase, tenantId, opts)
  return all.filter((s) => s.enabled).map((s) => s.key)
}
