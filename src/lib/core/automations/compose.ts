import type { SupabaseClient } from '@supabase/supabase-js'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { getSource } from '@/lib/core/automations/sources'
import { findOrCreateTrigger, listTriggers } from '@/lib/core/automations/store'
import { describeTrigger } from '@/lib/core/automations/describe'
import { variablesNotProvidedBy } from '@/lib/core/automations/render'
import { UNIVERSAL_VARIABLES } from '@/lib/core/automations/types'

/**
 * As regras que decidem se um "quando + mensagem" formam uma automação válida.
 *
 * Extraído de `POST /api/automacoes` quando a EDIÇÃO passou a existir: criar e
 * editar precisam responder às mesmas perguntas — a fonte existe? o plano
 * inclui ela? os parâmetros passam no schema dela? a mensagem só usa variáveis
 * que essa fonte sabe preencher? Deixar isso duplicado nas duas rotas garantia
 * que uma delas ficaria para trás, e a que ficasse aceitaria gravar automação
 * que o motor não sabe executar.
 */

export type ComposeErro =
  | { code: 'FONTE_DESCONHECIDA'; status: 400 }
  | { code: 'FONTE_INDISPONIVEL'; status: 403 }
  | { code: 'PARAMETROS_INVALIDOS'; status: 400; detail: string }
  | { code: 'MENSAGEM_NAO_ENCONTRADA'; status: 404 }
  | { code: 'VARIAVEL_NAO_FORNECIDA'; status: 400; detail: string }
  | { code: 'GATILHO_NAO_ENCONTRADO'; status: 404 }

export interface ComposeOk {
  triggerId: string
  source: string
  params: Record<string, unknown>
  /** Nome derivado da fonte — vira o nome da automação quando a clínica não deu um. */
  nomeDerivado: string
  /** Fonte ancorada ignora horário do dia; ver `sendAtLocalFor`. */
  ancorada: boolean
}

/**
 * Resolve o gatilho a partir de `source + params` (criando ou REAPROVEITANDO),
 * ou a partir de um `triggerId` que já existe.
 *
 * O reaproveitamento é o motivo de a edição do "quando" NÃO poder mudar a linha
 * do gatilho no lugar: duas automações com o mesmo quando compartilham uma só
 * (é o que impede o motor de varrer a mesma pergunta duas vezes). Mutar aquela
 * linha para atender a edição de UMA automação mudaria silenciosamente a hora
 * de todas as outras que a dividem. Por isso aqui sempre se resolve para um id
 * — novo ou existente — e quem chama apenas REAPONTA a automação para ele.
 */
export async function resolveTrigger(
  supabase: SupabaseClient,
  input: {
    tenantId: string
    actorUserId: string
    triggerId?: string
    source?: string
    params?: Record<string, unknown>
  },
): Promise<{ ok: ComposeOk } | { erro: ComposeErro }> {
  if (input.triggerId) {
    const gatilho = (await listTriggers(supabase, input.tenantId)).find(
      (g) => g.id === input.triggerId,
    )
    if (!gatilho) return { erro: { code: 'GATILHO_NAO_ENCONTRADO', status: 404 } }
    const f = getSource(gatilho.source)
    if (!f) return { erro: { code: 'FONTE_DESCONHECIDA', status: 400 } }
    const params = gatilho.params ?? {}
    return {
      ok: {
        triggerId: gatilho.id,
        source: gatilho.source,
        params,
        nomeDerivado: describeTrigger(f, params),
        ancorada: Boolean(f.isAnchored?.(params)),
      },
    }
  }

  const source = input.source ?? ''
  const f = getSource(source)
  if (!f) return { erro: { code: 'FONTE_DESCONHECIDA', status: 400 } }

  // O módulo da fonte é conferido no SERVIDOR, não só escondendo a opção da
  // lista: a rota é chamável direto, e a fonte de vertical lê tabela de
  // vertical. Esconder na tela é conveniência; recusar aqui é o controle.
  if (f.requiresModule) {
    const ent = await getTenantEntitlements(supabase, input.tenantId)
    if (!ent.hasModule(f.requiresModule as never)) {
      return { erro: { code: 'FONTE_INDISPONIVEL', status: 403 } }
    }
  }

  const v = f.paramsSchema.safeParse(input.params ?? {})
  if (!v.success) {
    return {
      erro: {
        code: 'PARAMETROS_INVALIDOS',
        status: 400,
        detail: v.error.issues[0]?.message ?? 'inválido',
      },
    }
  }
  const params = v.data as Record<string, unknown>

  const triggerId = await findOrCreateTrigger(supabase, {
    tenantId: input.tenantId,
    nomeDerivado: describeTrigger(f, params),
    source,
    params,
    actorUserId: input.actorUserId,
  })

  return {
    ok: {
      triggerId,
      source,
      params,
      nomeDerivado: describeTrigger(f, params),
      ancorada: Boolean(f.isAnchored?.(params)),
    },
  }
}

/**
 * A mensagem só pode pedir variáveis que ESTA fonte sabe preencher. O erro
 * aparece para quem está montando — não vira mensagem torta no celular do
 * paciente três dias depois.
 */
export async function validarMensagemParaFonte(
  supabase: SupabaseClient,
  input: { tenantId: string; messageTemplateId: string; source: string },
): Promise<{ ok: true; nomeMensagem: string } | { erro: ComposeErro }> {
  const fonte = getSource(input.source)
  if (!fonte) return { erro: { code: 'FONTE_DESCONHECIDA', status: 400 } }

  const { data: msg } = await supabase
    .from('message_templates')
    .select('body, name')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.messageTemplateId)
    .maybeSingle()
  if (!msg) return { erro: { code: 'MENSAGEM_NAO_ENCONTRADA', status: 404 } }

  const faltando = variablesNotProvidedBy((msg as { body: string }).body, [
    ...UNIVERSAL_VARIABLES,
    ...fonte.variables,
  ])
  if (faltando.length > 0) {
    return {
      erro: {
        code: 'VARIAVEL_NAO_FORNECIDA',
        status: 400,
        detail: `A mensagem usa ${faltando
          .map((v) => `{{${v}}}`)
          .join(', ')}, que o gatilho "${fonte.label}" não fornece`,
      },
    }
  }
  return { ok: true, nomeMensagem: (msg as { name: string }).name }
}

/**
 * Horário de disparo não vale para fonte ancorada — "2 horas antes da consulta,
 * às 14:30" é contradição. Devolve o padrão em vez de aceitar um valor que o
 * motor ignoraria: guardar o que não vale faria a tela mostrar um horário que
 * nunca acontece.
 */
export function sendAtLocalFor(ancorada: boolean, pedido: string | undefined): string | undefined {
  return ancorada ? '09:00' : pedido
}
