/**
 * Varredura em lotes das consultas da API de parceiro.
 *
 * O PostgREST corta a resposta em 1.000 linhas SEM avisar. Consulta sem
 * varredura conclui em silêncio sobre um pedaço dos dados — mesma classe de
 * defeito que a 0194 achou no catálogo TUSS e a 056 nas fontes de automação.
 * Aqui o preço é maior: num fechamento contábil, é dinheiro faltando sem
 * mensagem de erro.
 */

import { PartnerDenied } from './errors'

/** Tamanho do lote — o teto de uma resposta do PostgREST. */
export const LOTE = 1000

type Consulta = (
  de: number,
  ate: number,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>

/**
 * Varre até acabar, sem teto.
 *
 * Só para conjuntos que a natureza do dado limita (as clínicas de um parceiro,
 * por exemplo). Para o que cresce com o movimento da clínica, use `varrerAte`,
 * que recusa em vez de varrer sem fim.
 */
export async function varrerTudo<T>(consulta: Consulta, rotulo: string): Promise<T[]> {
  const out: T[] = []
  for (let inicio = 0; ; inicio += LOTE) {
    const { data, error } = await consulta(inicio, inicio + LOTE - 1)
    if (error) throw new Error(`${rotulo} failed: ${error.message}`)
    const lote = (data ?? []) as T[]
    out.push(...lote)
    if (lote.length < LOTE) return out
  }
}

/**
 * Varre até acabar OU até o teto, e RECUSA em vez de truncar.
 *
 * Devolver os primeiros N em silêncio seria pior que recusar: quem soma a
 * resposta acredita que somou o mês, e um fechamento a menos não vem com
 * mensagem de erro. O 400 diz o que fazer — consultar por intervalos menores.
 */
export async function varrerAte<T>(
  consulta: Consulta,
  teto: number,
  rotulo: string,
  mensagem: string,
): Promise<T[]> {
  const out: T[] = []
  for (let inicio = 0; inicio < teto; inicio += LOTE) {
    const { data, error } = await consulta(inicio, inicio + LOTE - 1)
    if (error) throw new Error(`${rotulo} failed: ${error.message}`)
    const lote = (data ?? []) as T[]
    out.push(...lote)
    if (lote.length < LOTE) return out
  }
  throw new PartnerDenied(400, 'PERIODO_MUITO_LONGO', mensagem)
}
