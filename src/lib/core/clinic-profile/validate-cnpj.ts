/**
 * Validação de CNPJ — algoritmo oficial módulo 11.
 *
 * O CNPJ tem 14 dígitos onde os 2 últimos são dígitos verificadores
 * calculados sobre os 12 anteriores com pesos específicos.
 */

const WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const
const WEIGHTS_SECOND = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const

/**
 * Mantém apenas dígitos. `formatCnpj` e `isValidCnpj` aceitam input com ou
 * sem máscara — esta função é o ponto único de normalização.
 */
export function stripCnpj(input: string): string {
  return (input ?? '').replace(/\D+/g, '')
}

/**
 * Aplica máscara visual `00.000.000/0000-00`. Se o input não tem 14 dígitos,
 * retorna o que conseguir parcialmente formatar (UI usa em onBlur/typing).
 */
export function formatCnpj(digits: string): string {
  const d = stripCnpj(digits)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`
}

function calcDigit(digits: number[], weights: readonly number[]): number {
  const sum = digits.reduce((acc, d, i) => acc + d * (weights[i] ?? 0), 0)
  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}

/**
 * Retorna true se o CNPJ informado tem 14 dígitos e os dois dígitos
 * verificadores conferem. Rejeita também CNPJs com todos os dígitos iguais
 * (ex.: `11111111111111`) que passariam pelo cálculo mas são inválidos por
 * convenção.
 */
export function isValidCnpj(input: string): boolean {
  const d = stripCnpj(input)
  if (d.length !== 14) return false
  if (/^(\d)\1{13}$/.test(d)) return false

  const numbers = d.split('').map((c) => Number.parseInt(c, 10))
  const dv1 = calcDigit(numbers.slice(0, 12), WEIGHTS_FIRST)
  if (dv1 !== numbers[12]) return false

  const dv2 = calcDigit(numbers.slice(0, 13), WEIGHTS_SECOND)
  if (dv2 !== numbers[13]) return false

  return true
}
