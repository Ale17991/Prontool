/**
 * Feature 053 — tipos do motor de notificações por comportamento.
 *
 * O gatilho aqui é **ausência de evento** — "não marcou há 3 dias" — e ausência
 * não é publicável num event bus: ninguém emite o evento de não ter feito algo.
 * Por isso o motor é varredura temporal, e não assinante do `DomainEvent`.
 *
 * A distinção que atravessa o arquivo inteiro é `SignalNature`. Ela não é
 * temática: muda quais filtros se aplicam. Uma família de CELEBRAÇÃO observa
 * evento presente no dado (o paciente atingiu a meta, marcou sete dias
 * seguidos), então não há suposição a controlar nem acusação possível — escapa
 * do filtro de portal e da validação de linguagem, que existem só para proteger
 * contra a inferência de ausência.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { z } from 'zod'

// ---------------------------------------------------------------------------
// Famílias
// ---------------------------------------------------------------------------

export type SignalNature = 'celebracao' | 'ausencia'

export type SignalFamilyId =
  // Celebração — prioridade < 10 (ver INVARIANTE em catalog.ts)
  | 'meta_atingida'
  | 'sequencia_habito'
  | 'aniversario'
  | 'aniversario_acompanhamento'
  | 'pos_consulta'
  // Ausência — prioridade >= 10
  | 'sem_acesso_portal'
  | 'habito_sem_registro'
  | 'sem_registrar_medicao'
  | 'recordatorio_em_branco'
  | 'afastando_da_meta'
  | 'exame_nao_realizado'
  | 'sem_retorno'
  | 'avaliacao_vencida'
  | 'plano_sem_revisao'

/**
 * Um paciente que bate a condição da regra neste ciclo.
 *
 * `observed` vai cru para `signal_occurrences.observed` — é o que permite
 * responder depois "por que este paciente entrou?". `values` alimenta os
 * placeholders do texto.
 */
export interface SignalCandidate {
  patientId: string
  observed: Record<string, unknown>
  values: Record<string, string>
}

export interface EvaluationContext {
  supabase: SupabaseClient<Database>
  tenantId: string
  /** Params já validados pelo `paramsSchema` da família. */
  params: Record<string, unknown>
  /** Pacientes elegíveis pelo público da regra — a família não resolve audiência. */
  patientIds: string[]
  /** "Hoje" no fuso da clínica, não do servidor. */
  cycleDate: string
  timezone: string
}

export interface SignalFamily {
  id: SignalFamilyId
  nature: SignalNature
  label: string
  description: string

  /** Zod dos parâmetros que a clínica preenche. Validado na escrita e na leitura. */
  paramsSchema: z.ZodType

  /** Campos que o texto pode usar. Texto com campo fora desta lista é recusado. */
  placeholders: readonly string[]

  /** Texto padrão. Em famílias de ausência, na voz "não vimos seu registro". */
  defaultTemplate: string

  /** Padrão da janela de silêncio, em dias. A clínica ajusta. */
  defaultSilenceDays: number

  /**
   * TRUE só quando a família observa REGISTRO FEITO PELO PACIENTE. Liga os dois
   * filtros de portal: elegibilidade (já entrou alguma vez) e supressão (entrou
   * dentro da janela).
   *
   * Marcar `false` numa família que observa registro do paciente reabre a
   * cobrança de quem talvez esteja cumprindo o hábito e só não registrou — o
   * dano que esta feature inteira existe para evitar.
   */
  requiresPortalActivity: boolean

  /**
   * Desempate quando várias regras concorrem pelo mesmo paciente e o teto
   * semanal binda. Menor fala primeiro. Celebração ocupa 1–9 e ausência 10+,
   * o que faz a precedência do reconhecimento valer sem lógica extra.
   */
  priority: number

  evaluate(ctx: EvaluationContext): Promise<SignalCandidate[]>
}

// ---------------------------------------------------------------------------
// Regras ligadas
// ---------------------------------------------------------------------------

export type SignalAudience = 'todos_ativos' | 'por_profissional'
export type SignalChannel = 'whatsapp' | 'email' | 'preferencial'

export interface SignalRule {
  id: string
  tenantId: string
  family: SignalFamilyId
  params: Record<string, unknown>
  audience: SignalAudience
  audienceDoctorId: string | null
  channel: SignalChannel
  messageTemplate: string
  silenceDays: number
  active: boolean
  createdAt: string
}

// ---------------------------------------------------------------------------
// Ocorrências
// ---------------------------------------------------------------------------

/**
 * O desfecho do encontro entre uma regra e um paciente num ciclo.
 *
 * Os que NÃO enviaram são gravados igual aos que enviaram, de propósito: sem
 * eles é impossível responder "por que meu paciente não recebeu?", que é a
 * primeira pergunta que a clínica faz.
 */
export type SignalOutcome =
  | 'enviada'
  | 'silenciada'
  | 'adiada'
  | 'suprimida_sem_portal'
  | 'sem_consentimento'
  | 'sem_contato'
  | 'falha_envio'

export interface SignalOccurrence {
  id: string
  tenantId: string
  ruleId: string
  patientId: string
  cycleDate: string
  outcome: SignalOutcome
  observed: Record<string, unknown>
  messageId: string | null
  createdAt: string
}
