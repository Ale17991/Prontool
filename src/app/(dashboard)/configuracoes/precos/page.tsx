import { permanentRedirect } from 'next/navigation'

/**
 * Rota legada — "Tabelas de Convênio" foi unificada em "Convênios"
 * (/configuracoes/convenios). permanentRedirect emite HTTP 308 pra que browsers
 * e proxies cacheem o redirect e bookmarks antigos sigam direto.
 */
export const dynamic = 'force-dynamic'

export default function PrecosLegacyRedirectPage() {
  permanentRedirect('/configuracoes/convenios')
}
