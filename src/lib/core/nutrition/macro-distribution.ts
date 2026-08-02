/**
 * Distribuição da meta de macros entre as refeições do dia.
 *
 * A avaliação (046) responde "quanto o paciente precisa por dia"; o plano (047)
 * responde "o que ele vai comer". Faltava o meio de campo: **quanto de cada
 * refeição**. Sem isso a nutricionista só descobre que errou a mão no café da
 * manhã depois de montar o dia inteiro e ver o total estourar.
 *
 * Puro e isomórfico — roda no cliente para a meta por refeição aparecer ao vivo
 * no montador e no servidor para gravar/conferir.
 */

export interface MacroGrams {
  protG: number
  carbG: number
  lipG: number
}

export interface MealShare {
  /** Identificador estável da refeição na tela (não é o id do banco). */
  key: string
  name: string
  /** Fatia do VET destinada a esta refeição, em %. */
  pct: number
}

export interface MealTarget {
  key: string
  name: string
  pct: number
  kcal: number
  protG: number
  carbG: number
  lipG: number
}

export interface DistributionResult {
  meals: MealTarget[]
  /** Soma dos percentuais informados. 100 = dia inteiro alocado. */
  pctSum: number
  /** Quanto do VET ficou sem refeição (positivo) ou foi excedido (negativo). */
  unallocatedKcal: number
  /**
   * `true` quando os percentuais somam 100 (com folga de arredondamento). Não é
   * erro estar fora — enquanto a profissional digita, a soma passa por valores
   * intermediários e travar a tela nisso seria insuportável.
   */
  balanced: boolean
}

export const KCAL_PER_G = { prot: 4, carb: 4, lip: 9 } as const

/** Tolerância da soma dos percentuais — 0,1 p.p. absorve ruído de digitação. */
const PCT_TOLERANCE = 0.1

/**
 * Reparte a meta diária entre as refeições. Cada macro escala pelo percentual
 * da refeição — que é exatamente equivalente a recalcular pelo VET da refeição,
 * mas sem passar por kcal e voltar, o que só introduziria erro de ida e volta.
 *
 * Precisão cheia na saída: arredondar aqui faria a soma das refeições não
 * fechar com o total (12 refeições de 33,33 g viram 396 g, não 400).
 */
export function distributeMacros(args: {
  targetKcal: number
  macros: MacroGrams
  meals: readonly MealShare[]
}): DistributionResult {
  const { targetKcal, macros, meals } = args
  const pctSum = meals.reduce((s, m) => s + (Number.isFinite(m.pct) ? m.pct : 0), 0)

  const out: MealTarget[] = meals.map((m) => {
    const f = (Number.isFinite(m.pct) ? m.pct : 0) / 100
    return {
      key: m.key,
      name: m.name,
      pct: m.pct,
      kcal: targetKcal * f,
      protG: macros.protG * f,
      carbG: macros.carbG * f,
      lipG: macros.lipG * f,
    }
  })

  return {
    meals: out,
    pctSum,
    unallocatedKcal: targetKcal * (1 - pctSum / 100),
    balanced: Math.abs(pctSum - 100) <= PCT_TOLERANCE,
  }
}

/**
 * Divide 100% entre N refeições. O resto da divisão vai para a PRIMEIRA
 * refeição, não espalhado: assim a soma fecha exato em 100 e a profissional vê
 * de onde saiu a sobra, em vez de encontrar 33,34 num lugar aleatório.
 */
export function splitEvenly(count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor((100 / count) * 100) / 100
  const shares = Array.from({ length: count }, () => base)
  const resto = Math.round((100 - base * count) * 100) / 100
  shares[0] = Math.round((shares[0]! + resto) * 100) / 100
  return shares
}

/**
 * Distribuição de partida sugerida por número de refeições, no padrão de
 * consultório: as refeições principais concentram, os lanches completam.
 * É ponto de partida para a profissional ajustar — não recomendação clínica.
 */
export function suggestedShares(count: number): number[] {
  const PADRAO: Record<number, number[]> = {
    1: [100],
    2: [50, 50],
    3: [30, 40, 30],
    4: [25, 10, 40, 25],
    5: [25, 10, 35, 10, 20],
    6: [20, 10, 30, 10, 20, 10],
  }
  return PADRAO[count] ?? splitEvenly(count)
}

export interface MealActual {
  key: string
  kcal: number
  protG: number
  carbG: number
  lipG: number
}

export interface MealDelta {
  key: string
  name: string
  kcal: number
  protG: number
  carbG: number
  lipG: number
}

/**
 * Diferença entre o que a refeição tem e o que ela deveria ter (real − meta).
 * Positivo = acima da meta. Refeição sem meta definida não entra: comparar com
 * meta ausente produziria um "excesso" que é só a ausência do alvo.
 */
export function mealDeltas(
  targets: readonly MealTarget[],
  actuals: readonly MealActual[],
): MealDelta[] {
  const byKey = new Map(actuals.map((a) => [a.key, a]))
  const out: MealDelta[] = []
  for (const t of targets) {
    const a = byKey.get(t.key)
    if (!a) continue
    out.push({
      key: t.key,
      name: t.name,
      kcal: a.kcal - t.kcal,
      protG: a.protG - t.protG,
      carbG: a.carbG - t.carbG,
      lipG: a.lipG - t.lipG,
    })
  }
  return out
}

export type MacroPrescriptionMode = 'percent' | 'gkg'

export interface MacroPrescriptionInput {
  mode: MacroPrescriptionMode
  targetKcal: number
  weightKg: number
  /** Modo percentual: precisam somar 100. */
  protPct?: number
  carbPct?: number
  lipPct?: number
  /** Modo g/kg: carboidrato ausente vira o RESTO do VET. */
  protGkg?: number
  lipGkg?: number
  carbGkg?: number
}

export interface MacroPrescriptionResult extends MacroGrams {
  protKcal: number
  carbKcal: number
  lipKcal: number
  /** Percentual efetivo de cada macro no VET — útil para conferir o resultado. */
  protPct: number
  carbPct: number
  lipPct: number
  /**
   * Sobra de kcal quando o carboidrato foi prescrito em g/kg e proteína +
   * gordura + carboidrato não fecham o VET. `0` no modo resto.
   */
  residualKcal: number
}

/**
 * Prescrição dos macros a partir do VET.
 *
 * O modo **g/kg** é o que a nutricionista usa de fato: fixa proteína e gordura
 * por quilo de peso (1,8 g/kg de proteína, 1 g/kg de gordura) e deixa o
 * carboidrato **fechar o VET**. Prescrever os três por quilo e torcer para
 * bater a energia não é como a conta é feita na clínica.
 *
 * `carbGkg` explicitamente `0` é respeitado — dieta cetogênica é prescrição
 * legítima, e é diferente de "não informei o carboidrato".
 */
export function prescribeMacros(input: MacroPrescriptionInput): MacroPrescriptionResult {
  const { targetKcal, weightKg } = input
  let protG: number
  let carbG: number
  let lipG: number
  let residualKcal = 0

  if (input.mode === 'gkg') {
    protG = (input.protGkg ?? 0) * weightKg
    lipG = (input.lipGkg ?? 0) * weightKg
    if (input.carbGkg === undefined || input.carbGkg === null) {
      const restoKcal = targetKcal - protG * KCAL_PER_G.prot - lipG * KCAL_PER_G.lip
      // Proteína e gordura já estouraram o VET: o carboidrato não pode ser
      // negativo, então zera e o excesso vira resíduo VISÍVEL — esconder isso
      // faria a tela mostrar uma prescrição que não fecha.
      carbG = restoKcal > 0 ? restoKcal / KCAL_PER_G.carb : 0
      residualKcal = restoKcal < 0 ? restoKcal : 0
    } else {
      carbG = input.carbGkg * weightKg
      residualKcal =
        targetKcal - (protG * KCAL_PER_G.prot + carbG * KCAL_PER_G.carb + lipG * KCAL_PER_G.lip)
    }
  } else {
    protG = (targetKcal * (input.protPct ?? 0)) / 100 / KCAL_PER_G.prot
    carbG = (targetKcal * (input.carbPct ?? 0)) / 100 / KCAL_PER_G.carb
    lipG = (targetKcal * (input.lipPct ?? 0)) / 100 / KCAL_PER_G.lip
  }

  const protKcal = protG * KCAL_PER_G.prot
  const carbKcal = carbG * KCAL_PER_G.carb
  const lipKcal = lipG * KCAL_PER_G.lip
  const pct = (k: number) => (targetKcal > 0 ? (k / targetKcal) * 100 : 0)

  return {
    protG,
    carbG,
    lipG,
    protKcal,
    carbKcal,
    lipKcal,
    protPct: pct(protKcal),
    carbPct: pct(carbKcal),
    lipPct: pct(lipKcal),
    residualKcal,
  }
}
