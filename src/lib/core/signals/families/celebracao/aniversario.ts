/**
 * Feature 053 — aniversário do paciente.
 *
 * A data de nascimento é cifrada, então a busca acontece dentro do banco
 * (`signals_birthdays_today`, migration 0193) e só os ids voltam. Descobrir
 * aniversariantes decifrando em TypeScript seria uma chamada por paciente,
 * todo dia, para a base inteira.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import type { EvaluationContext, SignalCandidate } from '../../types'

export async function evaluateAniversario(
  ctx: EvaluationContext,
): Promise<SignalCandidate[]> {
  if (ctx.patientIds.length === 0) return []

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    // Sem chave não dá para saber de ninguém. Silenciar é melhor que estourar:
    // as outras famílias do ciclo continuam funcionando.
    logger.error({ tenantId: ctx.tenantId }, 'aniversario-missing-encryption-key')
    return []
  }

  const supabase = ctx.supabase as SupabaseClient<Database>
  const { data, error } = await supabase.rpc('signals_birthdays_today', {
    p_tenant_id: ctx.tenantId,
    p_key: key,
    p_today: ctx.cycleDate,
  } as never)
  if (error) throw new Error(`aniversario: ${error.message}`)

  const doDia = new Set(
    ((data ?? []) as unknown as Array<{ patient_id: string }>).map((r) => r.patient_id),
  )

  // Interseção com o público da regra: a RPC devolve a clínica inteira, e a
  // regra pode estar segmentada por profissional.
  return ctx.patientIds
    .filter((id) => doDia.has(id))
    .map((patientId) => ({
      patientId,
      observed: { data: ctx.cycleDate },
      values: {},
    }))
}
