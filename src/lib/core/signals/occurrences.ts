/**
 * Feature 053 — ocorrências: o histórico e a base do anti-spam.
 *
 * Não existe contador materializado. Silêncio por regra e teto semanal são
 * CONSULTAS sobre esta tabela append-only. Contador precisaria de reset,
 * sofreria corrida entre ciclos e mentiria quando alguém corrigisse uma
 * ocorrência — derivar mantém uma fonte da verdade só. É o mesmo raciocínio do
 * status de entrega da 051, que é regra de leitura e não coluna.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { SignalOutcome } from './types'

const DIA_MS = 24 * 3600_000

export interface RecordOccurrenceInput {
  tenantId: string
  ruleId: string
  patientId: string
  cycleDate: string
  outcome: SignalOutcome
  observed: Record<string, unknown>
}

/**
 * Grava a ocorrência e devolve o id, ou `null` quando a linha já existia para
 * `(regra, paciente, dia)` — a unique da 0192 é a idempotência do ciclo
 * (FR-024), então conflito aqui é **funcionamento correto**, não erro:
 * significa que este dia já foi processado.
 *
 * O id volta porque a mensagem, quando sair, aponta para cá. A FK vai nesse
 * sentido justamente porque as duas tabelas são append-only: o vínculo tem que
 * nascer com quem chega por último.
 */
export async function recordOccurrence(
  supabase: SupabaseClient<Database>,
  input: RecordOccurrenceInput,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('signal_occurrences')
    .insert({
      tenant_id: input.tenantId,
      rule_id: input.ruleId,
      patient_id: input.patientId,
      cycle_date: input.cycleDate,
      outcome: input.outcome,
      observed: input.observed as never,
    } as never)
    .select('id')
    .single()

  if (!error) return (data as { id: string }).id
  // 23505 = unique_violation.
  if ((error as { code?: string }).code === '23505') return null
  throw new Error(`recordOccurrence failed: ${error.message}`)
}

/**
 * Pacientes desta regra que ainda estão dentro da janela de silêncio.
 *
 * Uma consulta por regra, não uma por paciente: a condição de ausência costuma
 * valer para dezenas de pacientes ao mesmo tempo, e N+1 aqui multiplicaria por
 * eles o custo do ciclo inteiro.
 */
export async function patientsInSilence(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  ruleId: string,
  silenceDays: number,
  now: Date,
): Promise<Set<string>> {
  const desde = new Date(now.getTime() - silenceDays * DIA_MS).toISOString()
  const { data, error } = await supabase
    .from('signal_occurrences')
    .select('patient_id')
    .eq('tenant_id', tenantId)
    .eq('rule_id', ruleId)
    .eq('outcome', 'enviada')
    .gte('created_at', desde)
  if (error) throw new Error(`patientsInSilence failed: ${error.message}`)
  return new Set((data ?? []).map((r) => (r as { patient_id: string }).patient_id))
}

/**
 * Quantas mensagens cada paciente já recebeu na semana corrente, somando TODAS
 * as regras. É o que alimenta o teto — o paciente percebe o volume total, não a
 * origem de cada mensagem.
 */
export async function sentCountLast7Days(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (patientIds.length === 0) return out

  const desde = new Date(now.getTime() - 7 * DIA_MS).toISOString()
  const { data, error } = await supabase
    .from('signal_occurrences')
    .select('patient_id')
    .eq('tenant_id', tenantId)
    .eq('outcome', 'enviada')
    .in('patient_id', patientIds)
    .gte('created_at', desde)
  if (error) throw new Error(`sentCountLast7Days failed: ${error.message}`)

  for (const row of data ?? []) {
    const id = (row as { patient_id: string }).patient_id
    out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}
