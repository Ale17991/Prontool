import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DOBRA_PROTOCOLS, type DobraProtocol } from '@/lib/core/nutrition/protocols'

/**
 * Feature 058 — a composição corporal como o PACIENTE a vê.
 *
 * Lê `nutrition_assessments` (046) e NÃO calcula nada: percentual de gordura,
 * massa gorda e massa magra saem do snapshot imutável gravado no dia da
 * avaliação (FR-013). Recalcular hoje mudaria o passado — a revisão de fórmulas
 * de agosto de 2026 tornou isso concreto, e uma avaliação de julho precisa
 * continuar mostrando o número de julho. É a mesma doutrina da 054: quem
 * apresenta recebe o resultado pronto do motor, nunca reimplementa o motor.
 *
 * O MÉTODO ANDA JUNTO DE CADA PONTO, e não como um rótulo do conjunto (FR-012).
 * Dobras cutâneas e bioimpedância não são comparáveis: sem o rótulo em cada
 * leitura, uma troca de instrumento pareceria evolução — o paciente veria "caiu
 * 3 pontos de gordura" onde só houve troca de aparelho.
 *
 * AUSÊNCIA NUNCA VIRA ZERO (FR-014). Avaliação sem composição apurada (só
 * antropometria, ou anterior aos campos) simplesmente não entra na série; e
 * dentro de um ponto, cada valor pode faltar sozinho e sai como travessão na
 * tela. `0%` de gordura não é um dado ruim: é um dado falso.
 */

export interface PortalCompositionPoint {
  id: string
  /** Data da avaliação (`YYYY-MM-DD` — coluna DATE, sem fuso). */
  assessedAt: string
  /** Peso do dia da avaliação, em kg. */
  weightKg: number | null
  /** Percentual de gordura apurado. */
  fatPct: number | null
  fatMassKg: number | null
  leanMassKg: number | null
  /** Chave do protocolo, como gravada. `null` em avaliação sem método. */
  method: string | null
  /** Rótulo do protocolo ("Bioimpedância", "Durnin & Womersley (1974)"). */
  methodLabel: string | null
}

export interface PortalCompositionView {
  /** Cronológica ascendente — a ordem de leitura de uma evolução. */
  points: PortalCompositionPoint[]
  /** A avaliação mais recente com composição, ou `null`. */
  latest: PortalCompositionPoint | null
  /**
   * Métodos distintos presentes na série. Mais de um ⇒ a tela avisa que as
   * leituras não são comparáveis entre si.
   */
  methodLabels: string[]
  /** Um ponto não é evolução: com menos de dois, nenhuma tendência é afirmada. */
  hasTrend: boolean
}

/**
 * Teto de leituras trazidas ao portal.
 *
 * É recorte de APRESENTAÇÃO, não paginação escondida: uma avaliação de
 * composição corporal acontece a cada consulta de acompanhamento, e vinte e
 * quatro delas já são anos de histórico num gráfico que precisa caber na tela
 * de um celular. O teto fica longe do corte silencioso de 1.000 linhas do
 * PostgREST — o problema que a 056 encontrou nas fontes de automação não existe
 * aqui, porque o limite é explícito e a ordem traz as mais recentes.
 */
const MAX_POINTS = 24

const COLS =
  'id, assessed_at, weight_kg, fat_pct, fat_mass_kg, lean_mass_kg, dobra_protocol, created_at'

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function methodLabelOf(protocol: string | null): string | null {
  if (!protocol) return null
  const meta = DOBRA_PROTOCOLS[protocol as DobraProtocol]
  // Protocolo gravado que o catálogo não conhece (versão futura, dado
  // importado) sai com a própria chave em vez de sumir: o paciente precisa
  // saber que as leituras vieram de métodos diferentes mesmo quando não
  // sabemos nomear um deles.
  return meta?.label ?? protocol
}

export async function getPortalBodyComposition(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<PortalCompositionView> {
  const { data, error } = await supabase
    .from('nutrition_assessments')
    .select(COLS)
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('assessed_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(MAX_POINTS)
  if (error) throw new Error(`getPortalBodyComposition: ${error.message}`)

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  const points = rows
    .map((r) => ({
      id: String(r.id),
      assessedAt: String(r.assessed_at).slice(0, 10),
      weightKg: num(r.weight_kg),
      fatPct: num(r.fat_pct),
      fatMassKg: num(r.fat_mass_kg),
      leanMassKg: num(r.lean_mass_kg),
      method: (r.dobra_protocol as string | null) ?? null,
      methodLabel: methodLabelOf((r.dobra_protocol as string | null) ?? null),
    }))
    // Avaliação que não apurou composição (só peso e circunferências, ou
    // anterior aos campos) fica FORA da série. Entrar com tudo nulo produziria
    // um buraco no gráfico que o paciente leria como queda.
    .filter((p) => p.fatPct !== null || p.fatMassKg !== null || p.leanMassKg !== null)
    .reverse()

  return buildCompositionView(points)
}

/**
 * A parte que decide o que a tela afirma, separada da consulta para poder ser
 * testada sem banco — mesmo motivo que levou `buildPortalHome` para fora do
 * componente na 057.
 */
export function buildCompositionView(points: PortalCompositionPoint[]): PortalCompositionView {
  const latest = points.length > 0 ? points[points.length - 1]! : null
  const methodLabels: string[] = []
  for (const p of points) {
    if (p.methodLabel && !methodLabels.includes(p.methodLabel)) methodLabels.push(p.methodLabel)
  }
  return {
    points,
    latest,
    methodLabels,
    // Dois pontos são o mínimo para existir "entre". Com um só, a tela mostra o
    // valor atual e cala sobre direção — afirmar tendência a partir de uma
    // medição é inventar a metade que não foi medida.
    hasTrend: points.length >= 2,
  }
}
