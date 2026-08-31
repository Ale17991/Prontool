import {
  logPartnerAccess,
  openPartnerClinicRequest,
  partnerDeniedResponse,
  respostaParceiro,
  statusDoErro,
} from '@/lib/core/partners/guard'
import { listPartnerServices } from '@/lib/core/partners/financeiro'
import { lerPeriodo, periodoInvalido } from '@/lib/core/partners/query'

/**
 * GET /api/parceiros/v1/clinicas/{id}/servicos
 *
 * Serviços prestados pela clínica — a descrição do serviço da nota fiscal.
 * Traz procedimento (código TUSS + descrição), valor, profissional, convênio e
 * o tomador (nome e CPF do paciente).
 *
 * Atendimento ESTORNADO vem na lista, marcado, com valor líquido já
 * descontado: é justamente o caso em que uma nota emitida precisa ser
 * cancelada, e escondê-lo faria o parceiro descobrir tarde.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ENDPOINT = 'GET /api/parceiros/v1/clinicas/{id}/servicos'

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
    const res = await listPartnerServices(ctx.supabase, params.id, periodo)
    await logPartnerAccess(ctx, {
      endpoint: ENDPOINT,
      tenantId: params.id,
      resultCount: res.servicos.length,
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
