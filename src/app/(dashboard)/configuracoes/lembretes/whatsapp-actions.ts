'use server'

/**
 * Feature 051 — US1 — Server actions da conexão de WhatsApp da clínica.
 *
 * RBAC: `whatsapp.config`, admin-only (FR-024). Deliberadamente mais restrito
 * que `reminders.config`, que inclui recepcionista — vincular o número é ato de
 * titularidade da clínica, com risco de bloqueio do número em jogo.
 *
 * A `api_key` da clínica no serviço de envio é decifrada aqui, usada na chamada
 * e descartada. Nunca volta ao browser, nunca entra em log.
 */

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { resolvePublicBaseUrl } from '@/lib/core/app-url'
import {
  getWhatsAppConnection,
  saveWhatsAppCredentials,
  getDecryptedApiKey,
  updateConnectionState,
  deleteWhatsAppConnection,
} from '@/lib/core/whatsapp/config'
import {
  provisionTenant,
  createInstance,
  connectInstance,
  listInstances,
  deleteInstance,
  isWhatsAppServiceConfigured,
} from '@/lib/core/whatsapp/service-client'
import type { WhatsAppConnection } from '@/lib/core/whatsapp/types'

interface ActionErr {
  ok: false
  error: 'UNAUTHORIZED' | 'NOT_CONFIGURED' | 'NO_CONNECTION' | 'INTERNAL_ERROR'
  message?: string
}
type ActionResult<T> = ({ ok: true } & T) | ActionErr

async function authorize(): Promise<
  { ok: true; tenantId: string; userId: string } | { ok: false; response: ActionErr }
> {
  const session = await getSession()
  if (!session) return { ok: false, response: { ok: false, error: 'UNAUTHORIZED' } }
  if (!can(session.role, 'whatsapp.config')) {
    return { ok: false, response: { ok: false, error: 'UNAUTHORIZED' } }
  }
  return { ok: true, tenantId: session.tenantId, userId: session.userId }
}

/**
 * Cliente de SERVIÇO: `tenant_whatsapp_config.api_key_enc` não é projetada para
 * usuário autenticado, e o decrypt usa RPC restrita. O escopo de tenant é
 * garantido explicitamente em cada query (Princípio III), não pelo RLS.
 */
function serviceDb(): SupabaseClient<Database> {
  return createSupabaseServiceClient() as unknown as SupabaseClient<Database>
}

/** Slug estável e previsível para a instância no serviço de envio. */
function slugFor(tenantSlug: string | null, tenantId: string): string {
  const base = (tenantSlug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
  const clean = base.replace(/^-|-$/g, '')
  // Sufixo do uuid evita colisão entre clínicas de nome parecido — o serviço
  // recusaria com 409, mas é melhor não chegar lá.
  return `${clean || 'clinica'}-${tenantId.slice(0, 8)}`.slice(0, 50)
}

// =========================================================================
// Leitura
// =========================================================================

export async function readConnection(): Promise<ActionResult<{ connection: WhatsAppConnection | null }>> {
  const auth = await authorize()
  if (!auth.ok) return auth.response
  try {
    const connection = await getWhatsAppConnection(serviceDb(), auth.tenantId)
    return { ok: true, connection }
  } catch (err) {
    logger.error({ tenantId: auth.tenantId }, 'whatsapp-read-connection-failed')
    return { ok: false, error: 'INTERNAL_ERROR', message: errText(err) }
  }
}

/**
 * Reconcilia o espelho local com o estado ao vivo no serviço. É o que a tela
 * chama em polling enquanto o QR está na tela esperando a leitura.
 */
export async function refreshConnection(): Promise<ActionResult<{ connection: WhatsAppConnection | null }>> {
  const auth = await authorize()
  if (!auth.ok) return auth.response
  const db = serviceDb()

  try {
    const current = await getWhatsAppConnection(db, auth.tenantId)
    if (!current) return { ok: true, connection: null }

    const apiKey = await getDecryptedApiKey(db, auth.tenantId)
    if (!apiKey) return { ok: true, connection: current }

    const instances = await listInstances(apiKey)
    const live = instances.find((i) => i.evolutionName === current.instanceName) ?? instances[0]
    if (!live) return { ok: true, connection: current }

    const status = live.status === 'open' ? 'connected' : live.status === 'close' ? 'disconnected' : 'connecting'
    await updateConnectionState(db, auth.tenantId, {
      status,
      instanceName: live.evolutionName,
      numberConnected: live.numberConnected,
      disconnectReason: live.disconnectReason,
    })
    revalidatePath('/configuracoes/lembretes')
    return { ok: true, connection: await getWhatsAppConnection(db, auth.tenantId) }
  } catch (err) {
    logger.error({ tenantId: auth.tenantId }, 'whatsapp-refresh-failed')
    return { ok: false, error: 'INTERNAL_ERROR', message: errText(err) }
  }
}

// =========================================================================
// Conexão
// =========================================================================

/**
 * Conecta (ou reconecta) o número. Devolve o QR em base64 para a tela exibir.
 *
 * Na primeira vez provisiona a clínica no serviço e guarda a credencial
 * cifrada. O provisionamento é idempotente por tenant, então reconectar depois
 * de um erro no meio do caminho não duplica nada nem rotaciona a chave.
 */
export async function connectWhatsApp(): Promise<ActionResult<{ qrCode: string | null }>> {
  const auth = await authorize()
  if (!auth.ok) return auth.response
  if (!isWhatsAppServiceConfigured()) {
    return { ok: false, error: 'NOT_CONFIGURED', message: 'WHATSAPP_SERVICE_URL não configurada' }
  }

  const db = serviceDb()

  try {
    let connection = await getWhatsAppConnection(db, auth.tenantId)

    // 1) Primeira vez: provisiona no serviço e guarda a credencial cifrada.
    if (!connection) {
      const { data: tenantRow } = await db
        .from('tenants')
        .select('name, slug')
        .eq('id', auth.tenantId)
        .maybeSingle()
      const tenant = tenantRow as { name: string | null; slug: string | null } | null

      const slug = slugFor(tenant?.slug ?? null, auth.tenantId)
      const provisioned = await provisionTenant({
        externalTenantId: auth.tenantId,
        slug,
        name: tenant?.name ?? 'Clínica',
        callbackUrl: `${resolvePublicBaseUrl()}/api/webhooks/whatsapp-status`,
      })

      await saveWhatsAppCredentials(db, {
        tenantId: auth.tenantId,
        serviceTenantSlug: provisioned.slug,
        apiKey: provisioned.apiKey,
        callbackSecret: provisioned.callbackSecret,
        createdByUserId: auth.userId,
      })
      connection = await getWhatsAppConnection(db, auth.tenantId)
    }

    const apiKey = await getDecryptedApiKey(db, auth.tenantId)
    if (!apiKey) return { ok: false, error: 'INTERNAL_ERROR', message: 'credencial ausente' }

    // 2) Instância existente reconecta; nova é criada.
    const result = connection?.instanceName
      ? { ...(await connectInstance(apiKey, connection.instanceName)), instanceName: connection.instanceName }
      : await createInstance(apiKey)

    await updateConnectionState(db, auth.tenantId, {
      status: 'connecting',
      instanceName: result.instanceName ?? connection?.instanceName ?? null,
      disconnectReason: null,
    })

    await auditConnectionAction(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: 'connect',
      detail: result.instanceName ?? connection?.instanceName ?? 'nova instância',
    })

    revalidatePath('/configuracoes/lembretes')
    return { ok: true, qrCode: result.qrCode }
  } catch (err) {
    logger.error({ tenantId: auth.tenantId }, 'whatsapp-connect-failed')
    return { ok: false, error: 'INTERNAL_ERROR', message: errText(err) }
  }
}

/**
 * Desvincula o número. O histórico de entrega é preservado — é append-only e
 * referencia lembretes que continuam existindo.
 */
export async function disconnectWhatsApp(): Promise<{ ok: true } | ActionErr> {
  const auth = await authorize()
  if (!auth.ok) return auth.response
  const db = serviceDb()

  try {
    const connection = await getWhatsAppConnection(db, auth.tenantId)
    if (!connection) return { ok: false, error: 'NO_CONNECTION' }

    const apiKey = await getDecryptedApiKey(db, auth.tenantId)
    if (apiKey && connection.instanceName) {
      // Best-effort: se o serviço estiver fora, ainda assim desvinculamos aqui
      // — deixar a clínica presa a uma conexão que ela não consegue remover é
      // pior que uma instância órfã no serviço.
      await deleteInstance(apiKey, connection.instanceName).catch(() => {})
    }

    await deleteWhatsAppConnection(db, auth.tenantId)
    await auditConnectionAction(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: 'disconnect',
      detail: connection.instanceName ?? 'sem instância',
    })
    revalidatePath('/configuracoes/lembretes')
    return { ok: true }
  } catch (err) {
    logger.error({ tenantId: auth.tenantId }, 'whatsapp-disconnect-failed')
    return { ok: false, error: 'INTERNAL_ERROR', message: errText(err) }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown'
}

/**
 * T021 — auditoria com ATOR (Princípio II).
 *
 * A migration 0185 já tem um trigger que registra toda mudança de estado da
 * conexão. Ele é a garantia de que o fato foi gravado mesmo que alguém mexa na
 * tabela por fora da aplicação — mas ele não sabe QUEM: depende de
 * `session_uuid('app.actor_id')`, que a aplicação não seta (a pool de conexões
 * torna `set_config` por requisição pouco confiável, e por isso o resto do
 * codebase também escreve em `audit_log` direto — ver
 * `core/audit/integration-events.ts`).
 *
 * Então são dois registros com papéis diferentes: o do trigger prova que
 * aconteceu, e este prova quem fez.
 */
async function auditConnectionAction(
  db: SupabaseClient<Database>,
  args: { tenantId: string; actorUserId: string; action: 'connect' | 'disconnect'; detail: string },
): Promise<void> {
  const { error } = await db.from('audit_log').insert({
    tenant_id: args.tenantId,
    actor_id: args.actorUserId,
    actor_label: null,
    entity: 'tenant_whatsapp_config',
    entity_id: args.tenantId,
    field: `whatsapp.${args.action}`,
    old_value: null,
    new_value: args.detail,
    reason: args.action === 'connect' ? 'admin vinculou o WhatsApp' : 'admin desvinculou o WhatsApp',
    result: 'success',
  })
  // Auditoria não pode derrubar a ação do usuário: ele conectou o número, e
  // falhar aqui faria a tela dizer que não conectou. Loga e segue.
  if (error) {
    logger.error({ tenantId: args.tenantId, action: args.action }, 'whatsapp-audit-insert-failed')
  }
}
