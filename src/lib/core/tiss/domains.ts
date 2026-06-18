/**
 * Feature 029 — acesso às tabelas de domínio TISS (`tiss_domain_tables`).
 *
 * Domínios oficiais da ANS (ex.: 38 glosas, 87 tabela-de-tabelas, 26 conselho,
 * 24 CBO, 59 UF, 52 tipo de consulta, 36 indicação de acidente, 48 técnica,
 * 50 tipo de atendimento, 23 caráter, 76 regime, 35 grau de participação).
 * Valores populados por `scripts/seed-tiss-domains.ts`. Leitura é read-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/generated/types'
import type { TissDomainNumber } from './version'

export interface TissDomainEntry {
  code: string
  description: string
}

type Client = SupabaseClient<Database>

/** Lista as entradas vigentes de um domínio (valid_to nulo ou no futuro). */
export async function listDomain(
  supabase: Client,
  domainNumber: TissDomainNumber,
): Promise<TissDomainEntry[]> {
  const { data, error } = await supabase
    .from('tiss_domain_tables')
    .select('code, description, valid_to')
    .eq('domain_number', domainNumber)
    .order('code', { ascending: true })
  if (error) throw new Error(`[tiss] falha ao listar domínio ${domainNumber}: ${error.message}`)
  const today = new Date().toISOString().slice(0, 10)
  return (data ?? [])
    .filter((r) => r.valid_to === null || r.valid_to >= today)
    .map((r) => ({ code: r.code, description: r.description }))
}

/**
 * Feature 031 — grau de participação (domínio TISS 35). Helpers nomeados
 * sobre os genéricos, para o seletor de equipe e a validação de participantes.
 */
export async function listParticipationDegrees(
  supabase: Client,
): Promise<TissDomainEntry[]> {
  return listDomain(supabase, '35')
}

export async function isValidParticipationDegree(
  supabase: Client,
  code: string,
): Promise<boolean> {
  return isValidDomainCode(supabase, '35', code)
}

/** Verifica se um código pertence (e está vigente) a um domínio. */
export async function isValidDomainCode(
  supabase: Client,
  domainNumber: TissDomainNumber,
  code: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('tiss_domain_tables')
    .select('code, valid_to')
    .eq('domain_number', domainNumber)
    .eq('code', code)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`[tiss] falha ao validar domínio ${domainNumber}/${code}: ${error.message}`)
  if (!data) return false
  const today = new Date().toISOString().slice(0, 10)
  return data.valid_to === null || data.valid_to >= today
}
