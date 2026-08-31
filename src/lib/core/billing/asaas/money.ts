/**
 * Conversão centavos ↔ reais na fronteira do Asaas.
 *
 * O sistema inteiro trabalha em centavos inteiros; o Asaas trabalha em reais
 * decimais. Toda a aritmética de dinheiro acontece em CENTAVOS e só o último
 * passo converte — o caminho inverso (dividir cedo, somar depois) acumula erro
 * de ponto flutuante e produz uma cobrança de R$ 149,89 onde deveria haver
 * R$ 149,90.
 *
 * Puro e sem I/O, para ser testável sem banco nem rede.
 */

import { ValidationError } from '@/lib/observability/errors'

/** Centavos → reais com 2 casas, para o corpo da requisição do Asaas. */
export function centsToReais(cents: number): number {
  if (!Number.isInteger(cents)) {
    throw new ValidationError(`Valor em centavos deve ser inteiro (recebido: ${cents})`)
  }
  return Math.round(cents) / 100
}

/**
 * Reais → centavos, para gravar o que o Asaas devolveu.
 *
 * O `Math.round` sobre o produto (e não `parseFloat` de string formatada) é o
 * que impede que 149.9 * 100 = 14989.999999999998 vire 14989.
 */
export function reaisToCents(reais: number | string | null | undefined): number | null {
  if (reais === null || reais === undefined || reais === '') return null
  const n = typeof reais === 'string' ? Number(reais) : reais
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

/**
 * Quanto o parceiro recebe de uma cobrança, em centavos.
 *
 * Regra de arredondamento: para BAIXO (`Math.floor`). O centavo da divisão
 * inexata fica com a Clinni, que é quem responde pela cobrança inteira perante
 * o Asaas — arredondar para cima poderia, num valor de borda, fazer a soma dos
 * splits exceder o bruto e o Asaas recusar a cobrança inteira.
 *
 * Devolve `null` quando o parceiro não tem regra de split configurada — o que
 * é diferente de zero: zero seria "divide nada", `null` é "não divide".
 */
export function splitAmountCents(
  amountCents: number,
  rule: { splitPercentBps: number | null; splitFixedCents: number | null },
): number | null {
  if (rule.splitFixedCents !== null && rule.splitFixedCents !== undefined) {
    // Split fixo maior que a cobrança é erro de cadastro, não motivo para
    // silenciosamente dividir tudo — o Asaas recusaria de todo jeito.
    if (rule.splitFixedCents > amountCents) {
      throw new ValidationError(
        `Split fixo (${rule.splitFixedCents}) maior que a cobrança (${amountCents}).`,
      )
    }
    return rule.splitFixedCents
  }
  if (rule.splitPercentBps !== null && rule.splitPercentBps !== undefined) {
    return Math.floor((amountCents * rule.splitPercentBps) / 10000)
  }
  return null
}
