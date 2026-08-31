/**
 * Leitura dos parâmetros comuns das rotas de parceiro.
 *
 * Existe para que as três rotas financeiras validem período e paginação do
 * MESMO jeito. Cada uma com o seu `parseInt` produziria três limites diferentes
 * e três mensagens de erro diferentes para o mesmo engano — e o parceiro
 * descobriria a regra por tentativa.
 */

import { MAX_POR_PAGINA, type Periodo } from './financeiro'
import { respostaParceiro } from './guard'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** `null` = parâmetro inválido; a rota responde 400 com `periodoInvalido()`. */
export function lerPeriodo(req: Request): (Periodo & { tipo?: 'entrada' | 'saida' }) | null {
  const url = new URL(req.url)
  const de = url.searchParams.get('de')
  const ate = url.searchParams.get('ate')
  if ((de && !DATE_RE.test(de)) || (ate && !DATE_RE.test(ate))) return null
  if (de && ate && de > ate) return null

  const pagina = Number(url.searchParams.get('pagina') ?? '1')
  const porPagina = Number(url.searchParams.get('por_pagina') ?? '100')
  if (!Number.isInteger(pagina) || pagina < 1) return null
  if (!Number.isInteger(porPagina) || porPagina < 1 || porPagina > MAX_POR_PAGINA) return null

  const tipo = url.searchParams.get('tipo')
  if (tipo && tipo !== 'entrada' && tipo !== 'saida') return null

  return {
    from: de ?? undefined,
    to: ate ?? undefined,
    pagina,
    porPagina,
    tipo: (tipo as 'entrada' | 'saida' | null) ?? undefined,
  }
}

export function periodoInvalido(): Response {
  return respostaParceiro(
    {
      error: {
        code: 'INVALID_QUERY',
        message: `Verifique de/ate (AAAA-MM-DD, de <= ate), pagina (>= 1), por_pagina (1..${MAX_POR_PAGINA}) e tipo (entrada|saida).`,
      },
    },
    400,
  )
}
