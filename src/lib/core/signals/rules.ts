/**
 * Feature 053 — CRUD das regras ligadas.
 *
 * A validação acontece aqui, e não só no banco, porque o CHECK do Postgres sabe
 * dizer "família inválida" mas não sabe dizer "o campo {{peso}} não existe nesta
 * família" — e é essa segunda mensagem que faz a clínica conseguir consertar o
 * texto sozinha.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { familyById } from './catalog'
import { findForbiddenPhrase } from './forbidden-phrases'
import { findUnknownPlaceholders } from './template'
import type { SignalRule } from './types'

export type RuleValidationError =
  | { code: 'UNKNOWN_FAMILY' }
  | { code: 'FAMILY_NOT_AVAILABLE' }
  | { code: 'INVALID_PARAMS'; detail: string }
  | { code: 'UNKNOWN_PLACEHOLDER'; campos: string[] }
  | { code: 'FORBIDDEN_PHRASE'; trecho: string; sugestao: string }
  | { code: 'INVALID_AUDIENCE' }
  | { code: 'INVALID_SILENCE' }

export interface RuleInput {
  family: string
  params: Record<string, unknown>
  audience: 'todos_ativos' | 'por_profissional'
  audienceDoctorId?: string | null
  channel: 'whatsapp' | 'email' | 'preferencial'
  messageTemplate: string
  silenceDays: number
}

/**
 * Valida na ordem em que a clínica consegue agir: primeiro a família, depois os
 * parâmetros, depois o texto. Reclamar do texto de uma família inexistente
 * mandaria ela consertar a coisa errada.
 */
export function validateRule(input: RuleInput): RuleValidationError | null {
  const familia = familyById(input.family)
  if (!familia) return { code: 'UNKNOWN_FAMILY' }
  // Família definida mas sem `evaluate`: aceitar aqui deixaria a clínica
  // esperando uma mensagem que o ciclo não sabe produzir.
  if (!familia.implemented) return { code: 'FAMILY_NOT_AVAILABLE' }

  const parsed = familia.paramsSchema.safeParse(input.params)
  if (!parsed.success) {
    return { code: 'INVALID_PARAMS', detail: parsed.error.issues[0]?.message ?? 'inválido' }
  }

  const desconhecidos = findUnknownPlaceholders(input.messageTemplate, familia.placeholders)
  if (desconhecidos.length > 0) return { code: 'UNKNOWN_PLACEHOLDER', campos: desconhecidos }

  // Só famílias de ausência passam pela lista: não há como acusar alguém de
  // algo que ele fez.
  if (familia.nature === 'ausencia') {
    const hit = findForbiddenPhrase(input.messageTemplate)
    if (hit) return { code: 'FORBIDDEN_PHRASE', trecho: hit.trecho, sugestao: hit.sugestao }
  }

  const temMedico = Boolean(input.audienceDoctorId)
  if ((input.audience === 'por_profissional') !== temMedico) {
    return { code: 'INVALID_AUDIENCE' }
  }

  if (!Number.isInteger(input.silenceDays) || input.silenceDays < 1 || input.silenceDays > 90) {
    return { code: 'INVALID_SILENCE' }
  }

  return null
}

export async function listRules(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<SignalRule[]> {
  const { data, error } = await supabase
    .from('signal_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listRules: ${error.message}`)
  return (data ?? []).map(toDomain)
}

export async function createRule(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: RuleInput,
  userId: string | null,
): Promise<SignalRule> {
  const { data, error } = await supabase
    .from('signal_rules')
    .insert({
      tenant_id: tenantId,
      family: input.family,
      params: input.params as never,
      audience: input.audience,
      audience_doctor_id: input.audienceDoctorId ?? null,
      channel: input.channel,
      message_template: input.messageTemplate,
      silence_days: input.silenceDays,
      created_by_user_id: userId,
    } as never)
    .select('*')
    .single()
  if (error) throw new Error(`createRule: ${error.message}`)
  return toDomain(data)
}

export async function updateRule(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  ruleId: string,
  patch: Partial<RuleInput> & { active?: boolean },
): Promise<SignalRule | null> {
  const row: Record<string, unknown> = {}
  if (patch.params !== undefined) row.params = patch.params
  if (patch.audience !== undefined) row.audience = patch.audience
  if (patch.audienceDoctorId !== undefined) row.audience_doctor_id = patch.audienceDoctorId
  if (patch.channel !== undefined) row.channel = patch.channel
  if (patch.messageTemplate !== undefined) row.message_template = patch.messageTemplate
  if (patch.silenceDays !== undefined) row.silence_days = patch.silenceDays
  if (patch.active !== undefined) row.active = patch.active
  if (Object.keys(row).length === 0) return null

  const { data, error } = await supabase
    .from('signal_rules')
    .update(row as never)
    .eq('tenant_id', tenantId)
    .eq('id', ruleId)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`updateRule: ${error.message}`)
  return data ? toDomain(data) : null
}

/**
 * Desativa, não apaga. `signal_occurrences` referencia a regra, e apagar
 * deixaria o histórico órfão — a clínica perderia a explicação de mensagens que
 * o paciente recebeu de verdade.
 */
export async function deactivateRule(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  ruleId: string,
): Promise<boolean> {
  const r = await updateRule(supabase, tenantId, ruleId, { active: false })
  return r !== null
}

function toDomain(row: unknown): SignalRule {
  const r = row as Record<string, unknown>
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    family: r.family as SignalRule['family'],
    params: (r.params ?? {}) as Record<string, unknown>,
    audience: r.audience as SignalRule['audience'],
    audienceDoctorId: (r.audience_doctor_id ?? null) as string | null,
    channel: r.channel as SignalRule['channel'],
    messageTemplate: r.message_template as string,
    silenceDays: r.silence_days as number,
    active: r.active as boolean,
    createdAt: r.created_at as string,
  }
}
