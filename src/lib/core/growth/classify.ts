/**
 * Curvas de crescimento infantil — classificação por percentil. Puro, sem I/O.
 *
 * A criança é avaliada contra a população da mesma idade e sexo, não contra um
 * valor absoluto: 12 kg é excelente aos 2 anos e grave aos 8. Por isso tudo
 * aqui depende de (indicador, sexo, idade em meses).
 *
 * ⚠️ PROCEDÊNCIA: os percentis vêm da aba `BD_Percentis` da planilha de
 * trabalho da nutricionista, que reproduz as curvas da OMS. Os PONTOS DE CORTE
 * de classificação abaixo seguem o que o Ministério da Saúde publica para o
 * SISVAN. Ambos merecem conferência clínica antes de virar decisão sobre
 * criança — a mesma ressalva das faixas laboratoriais da 050.
 */

export type GrowthIndicator = 'peso_idade' | 'estatura_idade' | 'imc_idade'

/** As nove colunas da tabela, em ordem crescente. */
export interface PercentileRow {
  ageMonths: number
  p01: number
  p3: number
  p5: number
  p10: number
  p15: number
  p50: number
  p85: number
  p97: number
  p999: number
}

export const PERCENTILE_KEYS = [
  'p01',
  'p3',
  'p5',
  'p10',
  'p15',
  'p50',
  'p85',
  'p97',
  'p999',
] as const

export const PERCENTILE_VALUE: Record<(typeof PERCENTILE_KEYS)[number], number> = {
  p01: 0.1,
  p3: 3,
  p5: 5,
  p10: 10,
  p15: 15,
  p50: 50,
  p85: 85,
  p97: 97,
  p999: 99.9,
}

export type GrowthClass =
  | 'muito_baixo'
  | 'baixo'
  | 'adequado'
  | 'risco'
  | 'elevado'
  | 'muito_elevado'

export interface GrowthResult {
  indicator: GrowthIndicator
  ageMonths: number
  value: number
  /** Percentil aproximado da criança (interpolado entre as colunas). */
  percentile: number
  classification: GrowthClass
  label: string
  /** A linha de percentis usada, já interpolada para a idade exata. */
  row: PercentileRow
}

/**
 * Interpola linearmente entre os dois meses que cercam a idade.
 *
 * Uma criança de 18 meses e meio não está "no mês 18": usar a linha inteira
 * mais próxima cria degraus na curva e classifica errado quem está na fronteira
 * de faixa. Fora do intervalo da tabela devolve `null` — extrapolar curva de
 * crescimento é inventar dado.
 */
export function interpolateRow(
  rows: readonly PercentileRow[],
  ageMonths: number,
): PercentileRow | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => a.ageMonths - b.ageMonths)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  if (ageMonths < first.ageMonths || ageMonths > last.ageMonths) return null

  let lo = first
  let hi = last
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i]!.ageMonths <= ageMonths && ageMonths <= sorted[i + 1]!.ageMonths) {
      lo = sorted[i]!
      hi = sorted[i + 1]!
      break
    }
  }
  if (lo.ageMonths === hi.ageMonths) return { ...lo, ageMonths }

  const t = (ageMonths - lo.ageMonths) / (hi.ageMonths - lo.ageMonths)
  const out = { ageMonths } as PercentileRow
  for (const k of PERCENTILE_KEYS) {
    out[k] = lo[k] + (hi[k] - lo[k]) * t
  }
  return out
}

/**
 * Percentil aproximado da criança. Interpola dentro da faixa em que o valor
 * cai; abaixo da primeira coluna ou acima da última, satura — dizer "percentil
 * 0,02" a partir de uma tabela que começa em 0,1 seria precisão inventada.
 */
export function estimatePercentile(row: PercentileRow, value: number): number {
  const points = PERCENTILE_KEYS.map((k) => ({ p: PERCENTILE_VALUE[k], v: row[k] }))
  if (value <= points[0]!.v) return points[0]!.p
  const lastPoint = points[points.length - 1]!
  if (value >= lastPoint.v) return lastPoint.p

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    if (value >= a.v && value <= b.v) {
      if (b.v === a.v) return a.p
      const t = (value - a.v) / (b.v - a.v)
      return a.p + (b.p - a.p) * t
    }
  }
  return 50
}

interface Band {
  max: number
  cls: GrowthClass
  label: string
}

/**
 * Pontos de corte por indicador (percentil da criança → classificação).
 *
 * Peso/idade e estatura/idade NÃO têm faixa superior de risco: criança alta ou
 * pesada para a idade não é diagnóstico por si — quem responde por excesso de
 * peso é o IMC/idade, que leva a estatura em conta. Classificar "peso elevado"
 * por peso/idade rotularia como problema a criança simplesmente alta.
 */
const BANDS: Record<GrowthIndicator, Band[]> = {
  peso_idade: [
    { max: 0.1, cls: 'muito_baixo', label: 'Muito baixo peso para a idade' },
    { max: 3, cls: 'baixo', label: 'Baixo peso para a idade' },
    { max: 97, cls: 'adequado', label: 'Peso adequado para a idade' },
    { max: Infinity, cls: 'elevado', label: 'Peso elevado para a idade' },
  ],
  estatura_idade: [
    { max: 0.1, cls: 'muito_baixo', label: 'Muito baixa estatura para a idade' },
    { max: 3, cls: 'baixo', label: 'Baixa estatura para a idade' },
    { max: Infinity, cls: 'adequado', label: 'Estatura adequada para a idade' },
  ],
  imc_idade: [
    { max: 0.1, cls: 'muito_baixo', label: 'Magreza acentuada' },
    { max: 3, cls: 'baixo', label: 'Magreza' },
    { max: 85, cls: 'adequado', label: 'Eutrofia' },
    { max: 97, cls: 'risco', label: 'Risco de sobrepeso' },
    { max: 99.9, cls: 'elevado', label: 'Sobrepeso' },
    { max: Infinity, cls: 'muito_elevado', label: 'Obesidade' },
  ],
}

export function classifyByPercentile(
  indicator: GrowthIndicator,
  percentile: number,
): { classification: GrowthClass; label: string } {
  for (const b of BANDS[indicator]) {
    // `<=` no limite: o percentil 3 exato ainda é baixo peso, seguindo a
    // convenção de "abaixo do percentil 3" incluir a própria linha.
    if (percentile <= b.max) return { classification: b.cls, label: b.label }
  }
  const last = BANDS[indicator][BANDS[indicator].length - 1]!
  return { classification: last.cls, label: last.label }
}

export function classifyGrowth(args: {
  indicator: GrowthIndicator
  rows: readonly PercentileRow[]
  ageMonths: number
  value: number
}): GrowthResult | null {
  const row = interpolateRow(args.rows, args.ageMonths)
  if (!row) return null
  const percentile = estimatePercentile(row, args.value)
  const { classification, label } = classifyByPercentile(args.indicator, percentile)
  return {
    indicator: args.indicator,
    ageMonths: args.ageMonths,
    value: args.value,
    percentile,
    classification,
    label,
    row,
  }
}

/** Idade em meses entre nascimento e a data da aferição. */
export function ageInMonths(birthDate: string, atDate: string): number {
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number) as [number, number, number]
  const [ay, am, ad] = atDate.slice(0, 10).split('-').map(Number) as [number, number, number]
  let months = (ay - by) * 12 + (am - bm)
  // Fração do mês pelo dia: a curva de um bebê muda rápido demais para
  // arredondar meio mês para baixo.
  const daysInMonth = new Date(Date.UTC(ay, am, 0)).getUTCDate()
  months += (ad - bd) / daysInMonth
  return Math.max(0, months)
}

export const GROWTH_LABEL: Record<GrowthIndicator, string> = {
  peso_idade: 'Peso para a idade',
  estatura_idade: 'Estatura para a idade',
  imc_idade: 'IMC para a idade',
}

/** Acima desta idade as curvas pediátricas não se aplicam. */
export const MAX_PEDIATRIC_AGE_MONTHS = 228 // 19 anos
