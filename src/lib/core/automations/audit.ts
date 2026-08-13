/**
 * Feature 056 — trilha de auditoria das automações (FR-018).
 *
 * Montar automação é ato administrativo com efeito sobre pacientes: decide
 * quem recebe mensagem e qual. Auditar criação, edição, ativação e desativação
 * é o que permite responder "quem ligou isso, quando e por quê" quando um
 * paciente reclamar — e é exigência do Princípio II da constituição.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'

export type AutomationEntity =
  | 'message_templates'
  | 'automation_triggers'
  | 'automations'
  // A janela de envio (0201) mora no perfil da clínica, e não numa automação:
  // ela vale para todas. Mudar quando o número pode falar com os pacientes é
  // exatamente o tipo de ato que precisa de ator e horário registrados.
  | 'tenant_clinic_profile'

export async function auditAutomation(
  supabase: SupabaseClient,
  args: {
    tenantId: string
    entity: AutomationEntity
    entityId: string
    field: string
    oldValue?: string | null
    newValue?: string | null
    reason: string
  },
): Promise<void> {
  const { error } = await supabase.rpc(
    'log_audit_event' as never,
    {
      p_tenant_id: args.tenantId,
      p_entity: args.entity,
      p_entity_id: args.entityId,
      p_field: args.field,
      p_old: args.oldValue ?? null,
      p_new: args.newValue ?? null,
      p_reason: args.reason,
    } as never,
  )
  if (error) {
    // Best-effort: perder a linha de auditoria não pode desfazer a operação que
    // o usuário já viu como concluída. Fica no log para investigação.
    logger.error({ entity: args.entity, entityId: args.entityId }, 'automation-audit-failed')
  }
}
