/**
 * Feature 056 — CRUD de mensagens, gatilhos e automações.
 *
 * Toda consulta filtra `tenant_id` EXPLICITAMENTE, mesmo quando o cliente tem
 * RLS: é o gate constitucional III (defesa em camadas), e o motor roda com
 * service client, onde a RLS não protege nada.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AutomationRow } from './types'

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export interface MessageTemplateDTO {
  id: string
  name: string
  body: string
  active: boolean
  /** Quantas automações dependem dela — a tela avisa ANTES da tentativa de excluir. */
  usadaPor: number
}

export async function listMessageTemplates(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<MessageTemplateDTO[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, name, body, active, automations(id)')
    .eq('tenant_id', tenantId)
    .order('name')

  if (error) throw new Error(`listMessageTemplates falhou: ${error.message}`)

  return (data ?? []).map((r) => {
    const row = r as { id: string; name: string; body: string; active: boolean; automations?: unknown[] }
    return {
      id: row.id,
      name: row.name,
      body: row.body,
      active: row.active,
      usadaPor: row.automations?.length ?? 0,
    }
  })
}

export async function createMessageTemplate(
  supabase: SupabaseClient,
  input: { tenantId: string; name: string; body: string; actorUserId: string },
): Promise<string> {
  const { data, error } = await supabase
    .from('message_templates')
    .insert({
      tenant_id: input.tenantId,
      name: input.name.trim(),
      body: input.body,
      created_by: input.actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('NOME_DUPLICADO')
    throw new Error(`createMessageTemplate falhou: ${error.message}`)
  }
  return data.id as string
}

export async function updateMessageTemplate(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
  patch: { name?: string; body?: string; active?: boolean },
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) payload.name = patch.name.trim()
  if (patch.body !== undefined) payload.body = patch.body
  if (patch.active !== undefined) payload.active = patch.active

  const { error } = await supabase
    .from('message_templates')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('NOME_DUPLICADO')
    throw new Error(`updateMessageTemplate falhou: ${error.message}`)
  }
}

/**
 * Exclusão é RECUSADA quando há automação dependente, e a recusa NOMEIA os
 * gatilhos (FR-004). "Não é possível excluir" sem dizer o quê obriga a clínica
 * a caçar — e ela vai caçar errado.
 */
export async function deleteMessageTemplate(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
): Promise<void> {
  const { data: deps, error: depsErr } = await supabase
    .from('automations')
    .select('automation_triggers(name)')
    .eq('tenant_id', tenantId)
    .eq('message_template_id', id)

  if (depsErr) throw new Error(`deleteMessageTemplate falhou: ${depsErr.message}`)

  if ((deps ?? []).length > 0) {
    const nomes = (deps as Array<{ automation_triggers?: { name?: string } | null }>)
      .map((d) => d.automation_triggers?.name)
      .filter((n): n is string => Boolean(n))
    throw new Error(`MENSAGEM_EM_USO:${nomes.join(', ')}`)
  }

  const { error } = await supabase
    .from('message_templates')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`deleteMessageTemplate falhou: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Gatilhos
// ---------------------------------------------------------------------------

export interface TriggerDTO {
  id: string
  name: string
  source: string
  params: Record<string, unknown>
  active: boolean
}

export async function listTriggers(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TriggerDTO[]> {
  const { data, error } = await supabase
    .from('automation_triggers')
    .select('id, name, source, params, active')
    .eq('tenant_id', tenantId)
    .order('name')
  if (error) throw new Error(`listTriggers falhou: ${error.message}`)
  return (data ?? []) as TriggerDTO[]
}

export async function createTrigger(
  supabase: SupabaseClient,
  input: {
    tenantId: string
    name: string
    source: string
    params: Record<string, unknown>
    actorUserId: string
  },
): Promise<string> {
  const { data, error } = await supabase
    .from('automation_triggers')
    .insert({
      tenant_id: input.tenantId,
      name: input.name.trim(),
      source: input.source,
      params: input.params,
      created_by: input.actorUserId,
    })
    .select('id')
    .single()
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('NOME_DUPLICADO')
    throw new Error(`createTrigger falhou: ${error.message}`)
  }
  return data.id as string
}

export async function updateTrigger(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
  patch: { name?: string; params?: Record<string, unknown>; active?: boolean },
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) payload.name = patch.name.trim()
  if (patch.params !== undefined) payload.params = patch.params
  if (patch.active !== undefined) payload.active = patch.active

  const { error } = await supabase
    .from('automation_triggers')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`updateTrigger falhou: ${error.message}`)
}

/**
 * Excluir gatilho leva junto as automações que o usam (CASCADE), diferente da
 * mensagem, que é recusada. A assimetria é proposital: o gatilho **é** a
 * automação do ponto de vista da clínica, e a mensagem é insumo compartilhado.
 */
export async function deleteTrigger(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('automation_triggers')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`deleteTrigger falhou: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Automações
// ---------------------------------------------------------------------------

export async function createAutomation(
  supabase: SupabaseClient,
  input: {
    tenantId: string
    triggerId: string
    messageTemplateId: string
    actorUserId: string
  },
): Promise<string> {
  const { data, error } = await supabase
    .from('automations')
    .insert({
      tenant_id: input.tenantId,
      trigger_id: input.triggerId,
      message_template_id: input.messageTemplateId,
      created_by: input.actorUserId,
    })
    .select('id')
    .single()
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('JA_EXISTE')
    throw new Error(`createAutomation falhou: ${error.message}`)
  }
  return data.id as string
}

export async function setAutomationActive(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('automations')
    .update({
      active,
      activated_at: active ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`setAutomationActive falhou: ${error.message}`)
}

/**
 * Desfaz o vínculo. O gatilho e a mensagem seguem existindo — é isto que
 * permite trocar a mensagem de um gatilho sem recriar o gatilho (FR-003).
 */
export async function deleteAutomation(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('automations')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`deleteAutomation falhou: ${error.message}`)
}

/**
 * As automações ativas de uma clínica, com tudo que o motor precisa numa
 * consulta só. Ordenação determinística por `created_at` — é ela que faz o
 * corte do teto por ciclo ser reprodutível entre execuções, em vez de sortear
 * quem fica de fora.
 */
export async function listActiveAutomations(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<AutomationRow[]> {
  const { data, error } = await supabase
    .from('automations')
    .select(
      `id, tenant_id, trigger_id, message_template_id, active,
       automation_triggers!inner(name, source, params, active),
       message_templates!inner(name, body, active)`,
    )
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`listActiveAutomations falhou: ${error.message}`)

  return (data ?? [])
    .map((r) => {
      // `as unknown as` porque o tipo gerado modela o join embutido como array
      // (é como o PostgREST descreve a relação), enquanto `!inner` devolve
      // objeto. O shape em runtime é o de baixo.
      const row = r as unknown as {
        id: string
        tenant_id: string
        trigger_id: string
        message_template_id: string
        active: boolean
        automation_triggers: { name: string; source: string; params: Record<string, unknown>; active: boolean }
        message_templates: { name: string; body: string; active: boolean }
      }
      return {
        id: row.id,
        tenantId: row.tenant_id,
        triggerId: row.trigger_id,
        messageTemplateId: row.message_template_id,
        active: row.active,
        source: row.automation_triggers.source,
        params: row.automation_triggers.params ?? {},
        body: row.message_templates.body,
        triggerName: row.automation_triggers.name,
        messageName: row.message_templates.name,
        _triggerActive: row.automation_triggers.active,
        _messageActive: row.message_templates.active,
      }
    })
    // Desativar o gatilho ou a mensagem cala a automação, sem precisar
    // desativá-la também — senão a clínica desliga um e continua enviando.
    .filter((r) => r._triggerActive && r._messageActive)
    .map(({ _triggerActive: _t, _messageActive: _m, ...rest }) => rest)
}
