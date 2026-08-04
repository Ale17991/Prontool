/**
 * Feature 053 — o paciente não abre o portal há N dias.
 *
 * É a família de reengajamento, e tem a prioridade mais alta entre as de
 * ausência por um motivo estrutural: ela atende exatamente quem as outras
 * suprimiram. Sem ela, o paciente que sumiu do portal ficaria sem contato
 * nenhum — pior que o problema original, porque a supressão teria transformado
 * "cobrança indevida" em "silêncio total" para quem mais precisa de um empurrão.
 *
 * `requiresPortalActivity` é `false` de propósito: aplicar o filtro de atividade
 * no portal aqui anularia a própria família.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { toDayNumber } from '@/lib/core/habits/period'
import type { EvaluationContext, SignalCandidate } from '../../types'

export async function evaluateSemAcessoPortal(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  const params = ctx.params as { days: number }
  if (ctx.patientIds.length === 0) return []

  const supabase = ctx.supabase as SupabaseClient<Database>

  // Último acesso de cada paciente. Ordenado do mais recente para o mais
  // antigo: a primeira linha de cada paciente é a que interessa, e uma query
  // resolve a base inteira.
  const { data, error } = await supabase
    .from('patient_portal_access_log')
    .select('patient_id, created_at')
    .eq('tenant_id', ctx.tenantId)
    .in('patient_id', ctx.patientIds)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`sem_acesso_portal: ${error.message}`)

  const ultimoAcesso = new Map<string, string>()
  for (const row of data ?? []) {
    const r = row as { patient_id: string; created_at: string }
    if (!ultimoAcesso.has(r.patient_id)) ultimoAcesso.set(r.patient_id, r.created_at)
  }

  const hojeN = toDayNumber(ctx.cycleDate)
  const out: SignalCandidate[] = []

  for (const patientId of ctx.patientIds) {
    const ultimo = ultimoAcesso.get(patientId)

    // ELEGIBILIDADE: quem nunca entrou não sumiu — nunca chegou. É outro
    // público, e mandar "faz tempo que não vemos você" para quem jamais usou o
    // portal soa como mensagem trocada, porque é.
    if (!ultimo) continue

    const diasSem = hojeN - toDayNumber(ultimo.slice(0, 10))
    if (diasSem < params.days) continue

    out.push({
      patientId,
      observed: { ultimoAcesso: ultimo, diasSemAcesso: diasSem, janelaDias: params.days },
      values: { dias: String(diasSem) },
    })
  }

  return out
}
