/**
 * Feature 056 — CRUD de mensagens, gatilhos e automações.
 *
 * Toda consulta filtra `tenant_id` EXPLICITAMENTE, mesmo quando o cliente tem
 * RLS: é o gate constitucional III (defesa em camadas), e o motor roda com
 * service client, onde a RLS não protege nada.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'
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

/**
 * O gatilho que corresponde a esta fonte com estes parâmetros — reaproveitando
 * o que já existir.
 *
 * A clínica não cria mais gatilho: ela cria uma AUTOMAÇÃO, e o gatilho nasce por
 * baixo. Duas automações com o mesmo "quando" (mesma fonte, mesmos parâmetros)
 * têm que compartilhar a mesma linha, e não por economia de espaço — o gatilho é
 * a unidade de ENUMERAÇÃO do motor, e duplicá-lo faria a mesma varredura rodar
 * duas vezes por ciclo, dobrando a consulta mais cara da feature.
 *
 * A comparação é sobre os parâmetros JÁ VALIDADOS pelo schema da fonte, nunca
 * sobre o que veio da tela: é o schema que normaliza `{ dias: 2 }` em
 * `{ antecedenciaMin: 2880 }`. Sem isso, o mesmo "quando" escrito de dois jeitos
 * criaria dois gatilhos que o motor trataria como diferentes.
 */
export async function findOrCreateTrigger(
  supabase: SupabaseClient,
  input: {
    tenantId: string
    nomeDerivado: string
    source: string
    params: Record<string, unknown>
    actorUserId: string
  },
): Promise<string> {
  const existentes = await listTriggers(supabase, input.tenantId)
  const igual = existentes.find(
    (t) => t.source === input.source && mesmoParams(t.params ?? {}, input.params),
  )
  if (igual) {
    // Um gatilho reaproveitado precisa estar ATIVO: ele pode ter sido desligado
    // junto com a última automação que o usava, e ressuscitá-lo em silêncio é
    // melhor que criar um segundo idêntico que o motor varreria em dobro.
    if (!igual.active) {
      await updateTrigger(supabase, input.tenantId, igual.id, { active: true })
    }
    return igual.id
  }

  // O nome do gatilho é interno (a clínica nomeia a automação), mas a coluna é
  // NOT NULL e única por clínica. O sufixo cobre o caso de o nome derivado já
  // estar ocupado por um gatilho de parâmetros diferentes — improvável, porque a
  // derivação inclui os parâmetros, e barato de garantir.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const nome = tentativa === 0 ? input.nomeDerivado : `${input.nomeDerivado} (${tentativa + 1})`
    try {
      return await createTrigger(supabase, {
        tenantId: input.tenantId,
        name: nome.slice(0, 80),
        source: input.source,
        params: input.params,
        actorUserId: input.actorUserId,
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'NOME_DUPLICADO') continue
      throw e
    }
  }
  throw new Error('findOrCreateTrigger: não foi possível nomear o gatilho')
}

/**
 * Dois conjuntos de parâmetros descrevem o mesmo "quando"?
 *
 * Comparação rasa por chave, e não `JSON.stringify`: a ordem das chaves em JSONB
 * não é a da inserção, então comparar o texto serializado diria que `{a,b}` e
 * `{b,a}` são gatilhos diferentes. Os parâmetros de fonte são planos (número,
 * texto, escolha) por construção — não há aninhamento a percorrer.
 */
function mesmoParams(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of chaves) {
    if (a[k] !== b[k]) return false
  }
  return true
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
    name: string
    triggerId: string
    messageTemplateId: string
    /** `HH:MM` no relógio da clínica. */
    sendAtLocal?: string
    actorUserId: string
  },
): Promise<string> {
  const { data, error } = await supabase
    .from('automations')
    .insert({
      tenant_id: input.tenantId,
      name: input.name.trim(),
      trigger_id: input.triggerId,
      message_template_id: input.messageTemplateId,
      send_at_local: input.sendAtLocal ?? '09:00',
      created_by: input.actorUserId,
    })
    .select('id')
    .single()
  if (error) {
    // Dois 23505 diferentes chegam aqui e a clínica precisa distinguir: o par
    // (gatilho, mensagem) repetido é "essa automação já existe", enquanto o nome
    // repetido é "escolha outro nome". Devolver a mesma mensagem para os dois
    // mandaria a clínica procurar uma automação idêntica que não existe.
    if ((error as { code?: string }).code === '23505') {
      throw new Error(
        /automations_tenant_name_uq/.test(error.message) ? 'NOME_DUPLICADO' : 'JA_EXISTE',
      )
    }
    throw new Error(`createAutomation falhou: ${error.message}`)
  }
  return data.id as string
}

export async function updateAutomation(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
  patch: {
    name?: string
    sendAtLocal?: string
    messageTemplateId?: string
    /**
     * REAPONTA a automação para outro gatilho — nunca edita o gatilho no lugar.
     * Gatilhos são compartilhados por automações com o mesmo "quando"
     * (`findOrCreateTrigger`), então alterar a linha para atender uma delas
     * mudaria a hora das outras sem ninguém pedir.
     */
    triggerId?: string
  },
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) payload.name = patch.name.trim()
  if (patch.sendAtLocal !== undefined) payload.send_at_local = patch.sendAtLocal
  if (patch.messageTemplateId !== undefined) payload.message_template_id = patch.messageTemplateId
  if (patch.triggerId !== undefined) payload.trigger_id = patch.triggerId

  const { error } = await supabase
    .from('automations')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) {
    if ((error as { code?: string }).code === '23505') throw new Error('NOME_DUPLICADO')
    throw new Error(`updateAutomation falhou: ${error.message}`)
  }
}

/**
 * Registra que esta automação varreu neste ciclo.
 *
 * `last_fired_on` fecha o dia para as automações de escala diária; `last_ran_at`
 * move a janela das ancoradas. É best-effort de propósito: falhar aqui repete a
 * varredura no ciclo seguinte, e o `UNIQUE (automação, paciente, chave)` recusa
 * a ocorrência repetida — o pior desfecho é trabalho pago duas vezes, nunca
 * mensagem duplicada no celular de ninguém.
 */
export async function markAutomationRan(
  supabase: SupabaseClient,
  id: string,
  input: { ranAt: Date; firedOn: string | null },
): Promise<void> {
  const payload: Record<string, unknown> = { last_ran_at: input.ranAt.toISOString() }
  if (input.firedOn) payload.last_fired_on = input.firedOn
  const { error } = await supabase.from('automations').update(payload).eq('id', id)
  if (error) {
    logger.warn({ automationId: id, err: error.message }, 'automations-mark-ran-failed')
  }
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
  if (error) {
    // 23503 = a FK da 0204 recusou: existe ocorrência, e ocorrência é prova de
    // que uma mensagem foi enviada a um paciente. O erro cru fala de constraint
    // e de outra tabela; quem está na tela precisa ouvir o que fazer no lugar.
    if ((error as { code?: string }).code === '23503') throw new Error('JA_ENVIOU')
    throw new Error(`deleteAutomation falhou: ${error.message}`)
  }
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
       name, send_at_local, last_fired_on, last_ran_at,
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
        name: string | null
        send_at_local: string | null
        last_fired_on: string | null
        last_ran_at: string | null
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
        name: row.name ?? row.automation_triggers.name,
        // `TIME` volta do PostgREST como `09:00:00`; o motor compara com o
        // relógio local em `HH:MM`, e comparar comprimentos diferentes de string
        // faria "14:30" nunca alcançar "14:30:00".
        sendAtLocal: (row.send_at_local ?? '09:00').slice(0, 5),
        lastFiredOn: row.last_fired_on,
        lastRanAt: row.last_ran_at,
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
