/**
 * Feature 050 — normalização de unidades de exame laboratorial.
 *
 * A fonte (`BD_Exames` do Evonut) traz as unidades sujas: espaços sobrando
 * (`" U/L"`, `"mg/dL "`), variação de caixa (`mcg/Ml`) e grafias equivalentes
 * para a mesma unidade (`µg/dL` = `mcg/dL`; `mcUI/mL` = `mUI/L`; `mg/dia` =
 * `mg/24h`). Gravar variantes distintas quebraria a comparação valor × faixa,
 * que assume unidade única por analito (não há conversão no v1).
 *
 * `normalizeUnit` **lança** em unidade desconhecida — de propósito. O importador
 * precisa falhar ruidosamente quando a planilha mudar, nunca gravar uma variante
 * nova em silêncio.
 *
 * Convenção: prefixo `mc` para micro em massa (`mcg`), coerente com
 * `micronutrients.ts` (049); `µmol/L` para micromol, que é como o laboratório
 * imprime. Puro/sem I/O.
 */

/** Unidades canônicas aceitas no catálogo de exames. */
export const CANONICAL_UNITS = [
  '%',
  '10⁶/mm³',
  'U/L',
  'U/mL',
  'fL',
  'g/dL',
  'mEq/L',
  'mIU/mL',
  'mUI/L',
  'mcg/L',
  'mcg/dL',
  'mcg/mL',
  'mg/24h',
  'mg/L',
  'mg/dL',
  'mm',
  'mm³',
  'mmol/L',
  'ng/dL',
  'ng/mL',
  'nmol/L',
  'pg',
  'pg/mL',
  'pmol/L',
  'µmol/L',
] as const

export type CanonicalUnit = (typeof CANONICAL_UNITS)[number]

const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_UNITS)

/**
 * Grafias equivalentes → canônica. A chave é comparada já em minúsculas e sem
 * espaços, então `"mcg/Ml"`, `"MCG/ML"` e `" mcg/ml "` caem todas no mesmo alvo.
 */
const ALIASES: Readonly<Record<string, CanonicalUnit>> = {
  // micro (µ / u / mc)
  'µg/dl': 'mcg/dL',
  'ug/dl': 'mcg/dL',
  'mcg/dl': 'mcg/dL',
  'µg/l': 'mcg/L',
  'ug/l': 'mcg/L',
  'mcg/l': 'mcg/L',
  'µg/ml': 'mcg/mL',
  'ug/ml': 'mcg/mL',
  'mcg/ml': 'mcg/mL',
  'µmol/l': 'µmol/L',
  'umol/l': 'µmol/L',
  'mcmol/l': 'µmol/L',
  // µUI/mL e mUI/L são a mesma grandeza (10⁻³ UI/L)
  'mcui/ml': 'mUI/L',
  'µui/ml': 'mUI/L',
  'uui/ml': 'mUI/L',
  'mui/l': 'mUI/L',
  // mIU/mL (= UI/L) é DIFERENTE de mUI/L — não são aliases entre si
  'miu/ml': 'mIU/mL',
  // excreção em 24 h
  'mg/dia': 'mg/24h',
  'mg/24h': 'mg/24h',
  // restantes, só normalizando caixa/espaço
  '%': '%',
  '10⁶/mm³': '10⁶/mm³',
  'u/l': 'U/L',
  'u/ml': 'U/mL',
  fl: 'fL',
  'g/dl': 'g/dL',
  'meq/l': 'mEq/L',
  'mg/l': 'mg/L',
  'mg/dl': 'mg/dL',
  mm: 'mm',
  'mm³': 'mm³',
  'mmol/l': 'mmol/L',
  'ng/dl': 'ng/dL',
  'ng/ml': 'ng/mL',
  'nmol/l': 'nmol/L',
  pg: 'pg',
  'pg/ml': 'pg/mL',
  'pmol/l': 'pmol/L',
}

export class UnknownUnitError extends Error {
  constructor(readonly raw: string) {
    super(`Unidade de exame desconhecida: ${JSON.stringify(raw)}`)
    this.name = 'UnknownUnitError'
  }
}

/**
 * Devolve a unidade canônica. Lança `UnknownUnitError` se a grafia não for
 * reconhecida — o importador deve tratar isso como falha, não como aviso.
 */
export function normalizeUnit(raw: string): CanonicalUnit {
  const trimmed = (raw ?? '').trim()
  if (CANONICAL_SET.has(trimmed)) return trimmed as CanonicalUnit
  const hit = ALIASES[trimmed.toLowerCase().replace(/\s+/g, '')]
  if (hit) return hit
  throw new UnknownUnitError(raw)
}

/** Versão não-lançante, para validação em lote. */
export function tryNormalizeUnit(raw: string): CanonicalUnit | null {
  try {
    return normalizeUnit(raw)
  } catch {
    return null
  }
}
