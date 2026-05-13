/**
 * Conversão entre alíquota percentual (UI, pt-BR ou en-US) e basis points
 * (1 bp = 0,01 %; 100 bps = 1 %; 10000 bps = 100 %). Feature 011.
 *
 * - Armazenamento canônico: inteiro em basis points (Constitution domain
 *   §"valores monetários em centavos, nunca float"). Estendemos a invariante
 *   "inteiro" para alíquotas.
 * - Locale pt-BR é o padrão da UI: vírgula como separador decimal.
 * - Aceitamos também `.` para tolerância (copy/paste do en-US).
 * - Half-up arredondamento explícito a 2 casas decimais: "6,505" → 651 bps.
 *
 * Funções puras, sem dependências externas.
 */

const PERCENT_MAX_INPUT = 100
const BPS_MAX = 10_000

/**
 * Converte string percentual (pt-BR ou en-US) para basis points.
 *
 * Aceita: "6,50", "6.50", "6,5", "6.5", "6", "06,50", "0", "100".
 * Rejeita: vazio, NaN, negativo, > 100, múltiplos separadores, letras.
 *
 * Arredondamento half-away-from-zero a 2 casas (centésimos de ponto
 * percentual), consistente com `Math.round(x * 100) / 100` do JS.
 *
 * @throws RangeError com mensagem em pt-BR.
 */
export function percentToBps(input: string): number {
  if (typeof input !== 'string') {
    throw new RangeError('Alíquota inválida: precisa ser texto.')
  }
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new RangeError('Alíquota inválida: vazia.')
  }

  // Aceita apenas dígitos, ponto, vírgula e um sinal negativo opcional
  // no início (capturado para mensagem específica de "negativo").
  // Bloqueia letras, sinais positivos, caracteres acentuados.
  if (!/^-?[0-9.,]+$/.test(trimmed)) {
    throw new RangeError('Alíquota inválida: use apenas dígitos e separador decimal (,).')
  }

  // Normaliza TODAS as vírgulas para ponto e detecta múltiplos separadores
  // ("1,2,3" / "1.2.3" são inválidos).
  const normalized = trimmed.replace(/,/g, '.')
  if ((normalized.match(/\./g) ?? []).length > 1) {
    throw new RangeError('Alíquota inválida: separador decimal duplicado.')
  }

  const asNumber = Number.parseFloat(normalized)
  if (!Number.isFinite(asNumber)) {
    throw new RangeError('Alíquota inválida: não é um número.')
  }
  if (asNumber < 0) {
    throw new RangeError('Alíquota inválida: deve ser maior ou igual a zero.')
  }
  if (asNumber > PERCENT_MAX_INPUT) {
    throw new RangeError('Alíquota inválida: máximo 100%.')
  }

  // Half-up para 2 casas decimais; Math.round em JS faz half-away-from-zero
  // (banker's é só Math.trunc(x*100+0.5)/100 quando positivo, equivalente
  // aqui já que x ≥ 0).
  const bps = Math.round(asNumber * 100)
  if (bps < 0 || bps > BPS_MAX) {
    throw new RangeError('Alíquota inválida: fora do intervalo permitido.')
  }
  return bps
}

/**
 * Converte basis points para string percentual pt-BR com 2 casas decimais
 * (vírgula como separador). Exemplos: 650 → "6,50"; 0 → "0,00"; 10000 → "100,00".
 *
 * @throws RangeError se bps não for inteiro entre 0 e 10000.
 */
export function bpsToPercent(bps: number): string {
  if (!bpsValid(bps)) {
    throw new RangeError('bps inválido: deve ser inteiro entre 0 e 10000.')
  }
  const whole = Math.floor(bps / 100)
  const fraction = bps % 100
  return `${whole},${fraction.toString().padStart(2, '0')}`
}

/**
 * True se `bps` é inteiro finito e está em [0, 10000].
 */
export function bpsValid(bps: number): boolean {
  return Number.isInteger(bps) && bps >= 0 && bps <= BPS_MAX
}
