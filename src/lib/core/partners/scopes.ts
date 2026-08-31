/**
 * Escopos e forma da chave de parceiro — a parte SEM segredo.
 *
 * Mora separada de `api-keys.ts` porque a tela do /admin é client component e
 * precisa listar os escopos. `api-keys.ts` importa `node:crypto`, e qualquer
 * caminho que leve um client component até ele quebra o `next build` com
 * `UnhandledSchemeError` — falha que `tsc` e `next lint` NÃO pegam.
 *
 * Regra: o que o navegador precisa ver mora aqui; o que hasheia, cifra ou
 * consulta o banco mora lá.
 */

/** Escopos existentes. Chave sem escopo não lê nada — nunca "tudo". */
export const PARTNER_SCOPES = ['clinicas:read', 'faturamento:read', 'financeiro:read'] as const
export type PartnerScope = (typeof PARTNER_SCOPES)[number]

export const SCOPE_LABEL: Record<PartnerScope, string> = {
  'clinicas:read': 'Ler as clínicas que usam o serviço do parceiro',
  'faturamento:read': 'Ler o repasse do parceiro (o que a Clinni divide com ele)',
  'financeiro:read': 'Ler o financeiro da clínica — serviços prestados, cobranças e movimentações',
}

/** Projeção segura de uma chave. NUNCA carrega o segredo nem o hash dele. */
export interface PartnerApiKey {
  id: string
  partnerId: string
  name: string
  keyPrefix: string
  scopes: PartnerScope[]
  /** `null` = sem restrição de origem. Array vazio bloqueia tudo (ver `ip.ts`). */
  allowedIps: string[] | null
  /** `null` = sem prazo. */
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}
