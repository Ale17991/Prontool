import {
  logPartnerAccess,
  openPartnerRequest,
  partnerDeniedResponse,
  respostaParceiro,
  statusDoErro,
} from '@/lib/core/partners/guard'
import { listPartnerBillingRecords } from '@/lib/core/partners/clinics'
import { lerPeriodo, periodoInvalido } from '@/lib/core/partners/query'

/**
 * GET /api/parceiros/v1/faturamento?de=&ate=&pendentes=1&pagina=&por_pagina=
 *
 * Cobranças com repasse a este parceiro, com os dados fiscais da clínica
 * (tomadora) prontos para virar nota.
 *
 * Só as PAGAS por padrão. Emitir nota de dinheiro que não entrou custa
 * retificação, e a fila em aberto é outra pergunta — quem quiser vê-la manda
 * `pendentes=1` e recebe a situação de cada uma para decidir.
 *
 * Sem período, devolve os últimos 90 dias. Uma consulta sem recorte varreria o
 * histórico inteiro a cada chamada, e o caso real do parceiro é fechar o mês.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ENDPOINT = 'GET /api/parceiros/v1/faturamento'

function noventaDiasAtras(): string {
  return new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
}

export async function GET(req: Request): Promise<Response> {
  let ctx
  try {
    ctx = await openPartnerRequest(req, 'faturamento:read')
  } catch (err) {
    return partnerDeniedResponse(err, ENDPOINT)
  }

  // Mesma validação das rotas financeiras: um só formato de erro para o mesmo
  // engano, em vez de um código por rota que o parceiro descobre por tentativa.
  const periodo = lerPeriodo(req)
  if (!periodo) {
    await logPartnerAccess(ctx, { endpoint: ENDPOINT, status: 400 })
    return periodoInvalido()
  }

  try {
    const from = periodo.from ?? noventaDiasAtras()
    const { registros, paginacao } = await listPartnerBillingRecords(
      ctx.supabase,
      {
        id: ctx.partner.id,
        splitPercentBps: ctx.partner.splitPercentBps,
        splitFixedCents: ctx.partner.splitFixedCents,
      },
      {
        from,
        to: periodo.to,
        incluirPendentes: new URL(req.url).searchParams.get('pendentes') === '1',
        pagina: periodo.pagina,
        porPagina: periodo.porPagina,
      },
    )
    // Soma a PÁGINA, e o nome do campo diz isso. Um total do período inteiro
    // exigiria varrer tudo a cada página — e um campo chamado "total" que muda
    // conforme a página é pior que um campo honesto sobre o seu recorte.
    const repassePagina = registros.reduce((s, r) => s + r.valor_repasse_centavos, 0)

    await logPartnerAccess(ctx, {
      endpoint: ENDPOINT,
      resultCount: registros.length,
      status: 200,
    })
    return respostaParceiro({
      periodo: { de: from, ate: periodo.to ?? null },
      paginacao,
      repasse_da_pagina_centavos: repassePagina,
      registros,
    })
  } catch (err) {
    await logPartnerAccess(ctx, { endpoint: ENDPOINT, status: statusDoErro(err) })
    return partnerDeniedResponse(err, ENDPOINT)
  }
}
