import {
  logPartnerAccess,
  openPartnerRequest,
  partnerDeniedResponse,
  respostaParceiro,
  statusDoErro,
} from '@/lib/core/partners/guard'
import { getPartnerClinic } from '@/lib/core/partners/clinics'

/**
 * GET /api/parceiros/v1/clinicas/{id}
 *
 * Cadastro completo da clínica, para o parceiro abrir a conta dele. Inclui
 * razão social, CNPJ, endereço, responsável técnico e UMA pessoa de contato.
 *
 * Clínica que NÃO é deste parceiro responde **404, nunca 403** — mesma doutrina
 * de `printouts/guard.ts`: 403 confirmaria que o id existe, e a lista de
 * clínicas da concorrência se levanta a partir de confirmações assim.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ENDPOINT = 'GET /api/parceiros/v1/clinicas/{id}'

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  let ctx
  try {
    ctx = await openPartnerRequest(req, 'clinicas:read')
  } catch (err) {
    return partnerDeniedResponse(err, ENDPOINT)
  }

  try {
    const clinica = await getPartnerClinic(ctx.supabase, ctx.partner.id, params.id)
    if (!clinica) {
      await logPartnerAccess(ctx, { endpoint: ENDPOINT, tenantId: null, status: 404 })
      return respostaParceiro(
        { error: { code: 'NOT_FOUND', message: 'Clínica não encontrada.' } },
        404,
      )
    }
    await logPartnerAccess(ctx, {
      endpoint: ENDPOINT,
      tenantId: clinica.id,
      resultCount: 1,
      status: 200,
    })
    return respostaParceiro({ clinica })
  } catch (err) {
    await logPartnerAccess(ctx, { endpoint: ENDPOINT, status: statusDoErro(err) })
    return partnerDeniedResponse(err, ENDPOINT)
  }
}
