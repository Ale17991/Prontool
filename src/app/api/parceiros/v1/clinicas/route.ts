import {
  logPartnerAccess,
  openPartnerRequest,
  partnerDeniedResponse,
  respostaParceiro,
  statusDoErro,
} from '@/lib/core/partners/guard'
import { listPartnerClinics } from '@/lib/core/partners/clinics'

/**
 * GET /api/parceiros/v1/clinicas
 *
 * Quais clínicas usam o serviço deste parceiro. O parceiro sai da CHAVE, nunca
 * da requisição — não há parâmetro que permita perguntar pela carteira alheia.
 *
 * Autenticação por `openPartnerRequest` (guard único da API de parceiro), que
 * chama o resolvedor de chave, confere o escopo e recusa parceiro inativo.
 * Reconhecido como autenticador em `scripts/check-require-role.mjs`.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ENDPOINT = 'GET /api/parceiros/v1/clinicas'

export async function GET(req: Request): Promise<Response> {
  let ctx
  try {
    ctx = await openPartnerRequest(req, 'clinicas:read')
  } catch (err) {
    return partnerDeniedResponse(err, ENDPOINT)
  }

  try {
    const clinicas = await listPartnerClinics(ctx.supabase, ctx.partner.id)
    await logPartnerAccess(ctx, {
      endpoint: ENDPOINT,
      resultCount: clinicas.length,
      status: 200,
    })
    return respostaParceiro({ total: clinicas.length, clinicas })
  } catch (err) {
    await logPartnerAccess(ctx, { endpoint: ENDPOINT, status: statusDoErro(err) })
    return partnerDeniedResponse(err, ENDPOINT)
  }
}
