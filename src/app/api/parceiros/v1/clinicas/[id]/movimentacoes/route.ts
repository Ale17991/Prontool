import {
  logPartnerAccess,
  openPartnerClinicRequest,
  partnerDeniedResponse,
  respostaParceiro,
  statusDoErro,
} from '@/lib/core/partners/guard'
import { listPartnerCashFlow } from '@/lib/core/partners/financeiro'
import { lerPeriodo, periodoInvalido } from '@/lib/core/partners/query'

/**
 * GET /api/parceiros/v1/clinicas/{id}/movimentacoes
 *
 * Entradas e saídas de caixa, numa lista só, ordenada por data.
 *
 * ENTRADA é a PARCELA PAGA, não a cobrança — é o pagamento que move o caixa, e
 * uma cobrança em 6x move seis vezes, em seis datas. Emitir nota pela data da
 * cobrança poria seis meses de receita na competência do primeiro mês.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ENDPOINT = 'GET /api/parceiros/v1/clinicas/{id}/movimentacoes'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  let ctx
  try {
    ctx = await openPartnerClinicRequest(req, 'financeiro:read', params.id)
  } catch (err) {
    return partnerDeniedResponse(err, ENDPOINT)
  }

  const periodo = lerPeriodo(req)
  if (!periodo) {
    await logPartnerAccess(ctx, { endpoint: ENDPOINT, tenantId: params.id, status: 400 })
    return periodoInvalido()
  }

  try {
    const res = await listPartnerCashFlow(ctx.supabase, params.id, periodo)
    await logPartnerAccess(ctx, {
      endpoint: ENDPOINT,
      tenantId: params.id,
      resultCount: res.movimentacoes.length,
      status: 200,
    })
    return respostaParceiro(res)
  } catch (err) {
    await logPartnerAccess(ctx, {
      endpoint: ENDPOINT,
      tenantId: params.id,
      status: statusDoErro(err),
    })
    return partnerDeniedResponse(err, ENDPOINT)
  }
}
