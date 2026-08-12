/**
 * Feature 056 — leitura e escrita do registro de ocorrências.
 *
 * A ocorrência é gravada ANTES da tentativa de envio, com desfecho `pendente`,
 * e atualizada depois. A ordem importa e não é detalhe: gravar depois abriria
 * janela para envio duplicado se o processo morresse entre mandar a mensagem e
 * registrar que mandou — e mensagem duplicada no WhatsApp do paciente é pior
 * que mensagem não enviada, porque é ela que faz denunciarem o número.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'
import type { OccurrenceOutcome } from './types'

export interface ClaimInput {
  tenantId: string
  automationId: string
  patientId: string
  occurrenceKey: string
}

/**
 * Tenta reservar a ocorrência. Devolve o id quando ESTA execução conseguiu — e
 * `null` quando a linha já existia, que é o caso de reexecução do ciclo.
 *
 * A exclusividade vem do `UNIQUE (automation_id, patient_id, occurrence_key)`,
 * não de um SELECT antes do INSERT: entre o SELECT e o INSERT cabe outra
 * execução do ciclo, e aí o paciente receberia duas vezes.
 */
export async function claimOccurrence(
  supabase: SupabaseClient,
  input: ClaimInput,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('automation_occurrences')
    .insert({
      tenant_id: input.tenantId,
      automation_id: input.automationId,
      patient_id: input.patientId,
      occurrence_key: input.occurrenceKey,
      outcome: 'pendente',
    })
    .select('id')
    .maybeSingle()

  if (error) {
    // 23505 = já existe. Não é falha: é o ciclo rodando de novo no mesmo dia.
    if ((error as { code?: string }).code === '23505') return null
    throw new Error(`claimOccurrence falhou: ${error.message}`)
  }
  return data?.id ?? null
}

export async function settleOccurrence(
  supabase: SupabaseClient,
  occurrenceId: string,
  outcome: Exclude<OccurrenceOutcome, 'pendente'>,
  extra: { reason?: string | null; providerMessageId?: string | null } = {},
): Promise<void> {
  const { error } = await supabase
    .from('automation_occurrences')
    .update({
      outcome,
      reason: extra.reason ?? null,
      provider_message_id: extra.providerMessageId ?? null,
    })
    .eq('id', occurrenceId)

  if (error) {
    // Não relança: o desfecho já aconteceu no mundo (a mensagem saiu ou não).
    // Derrubar o ciclo por falha de escrita do registro trocaria um problema de
    // observabilidade por um de entrega.
    logger.error({ occurrenceId, outcome }, 'automation-settle-occurrence-failed')
  }
}

/**
 * Libera uma ocorrência suprimida por teto, para o ciclo seguinte reavaliá-la.
 *
 * Sem isto, o paciente que ficou de fora por acaso de ordenação perderia a
 * mensagem para sempre — a chave estaria consumida. O trigger append-only da
 * 0196 permite DELETE exatamente e apenas nestes desfechos.
 */
export async function releaseSuppressed(
  supabase: SupabaseClient,
  occurrenceId: string,
): Promise<void> {
  const { error } = await supabase.from('automation_occurrences').delete().eq('id', occurrenceId)
  if (error) {
    // A mensagem do banco vai junto de propósito. Esta falha é invisível por
    // natureza — o ciclo continua, ninguém recebe erro — e o sintoma aparece só
    // dias depois, como "o paciente que o teto segurou nunca recebeu". Sem o
    // motivo no log, investigar isso começa do zero.
    logger.error({ occurrenceId, err: error.message }, 'automation-release-suppressed-failed')
  }
}

/**
 * Quantas mensagens de automação este paciente já consumiu hoje (FR-012).
 *
 * Conta `pendente` JUNTO com `enviado`, e isso não é descuido. Uma linha
 * pendente significa que já tentamos enviar para esse paciente hoje — se a
 * gravação do desfecho falhar por qualquer motivo, contar só `enviado` faria o
 * teto parar de enxergar o envio e mandar de novo. Entre o paciente perder uma
 * mensagem e receber duas, a segunda é pior: é ela que faz denunciarem o número
 * da clínica.
 */
export async function countSentToday(
  supabase: SupabaseClient,
  tenantId: string,
  patientId: string,
  sinceIso: string,
  /**
   * A ocorrência que está sendo avaliada AGORA. Ela já foi reservada como
   * `pendente` antes desta chamada, então sem excluí-la o contador enxergaria a
   * si mesmo e toda automação se auto-suprimiria.
   */
  exceptOccurrenceId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('automation_occurrences')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .in('outcome', ['enviado', 'pendente'])
    .neq('id', exceptOccurrenceId)
    .gte('created_at', sinceIso)

  if (error) throw new Error(`countSentToday falhou: ${error.message}`)
  return count ?? 0
}
