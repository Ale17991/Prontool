import {
  logPartnerAccess,
  openPartnerClinicRequest,
  partnerDeniedResponse,
  respostaParceiro,
  statusDoErro,
} from '@/lib/core/partners/guard'
import { listPartnerCharges } from '@/lib/core/partners/financeiro'
import { lerPeriodo, periodoInvalido } from '@/lib/core/partners/query'

/**
 * GET /api/parceiros/v1/clinicas/{id}/cobrancas
 *
 * O que a clínica cobrou do paciente: valor total, forma de pagamento,
 * situação e TODAS as parcelas com vencimento e baixa.
 *
 * É lista de COMBINADO, não de caixa. A cobrança em 6x aparece uma vez aqui e
 * seis vezes em `/movimentacoes` — quem emite nota por competência usa esta,
 * quem emite por recebimento usa aquela.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ENDPOINT = 'GET /api/parceiros/v1/clinicas/{id}/cobrancas'

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
    const res = await listPartnerCharges(ctx.supabase, params.id, periodo)
    await logPartnerAccess(ctx, {
      endpoint: ENDPOINT,
      tenantId: params.id,
      resultCount: res.cobrancas.length,
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
