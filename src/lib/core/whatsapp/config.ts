/**
 * Feature 051 — Leitura/escrita de `tenant_whatsapp_config`.
 *
 * A `api_key` da clínica no serviço de envio vive CIFRADA em `api_key_enc`
 * (enc_text_with_key / PATIENT_DATA_ENCRYPTION_KEY), mesmo padrão de
 * `tenant_memed_config` (0110). Nunca em env, nunca devolvida ao browser.
 *
 * Constituição:
 * - III multi-tenant: filtro EXPLÍCITO por tenant_id em toda query, mesmo com
 *   RLS ativo — o cron usa service-role e não teria a proteção do RLS.
 * - V RBAC: o caller é responsável (server action chama requireRole('admin')).
 *
 * O client é genérico em `Database` desde a T010 — os tipos foram regenerados
 * com a 0185 aplicada, então `tenant_whatsapp_config` é conhecida pelo
 * compilador e as queries daqui são checadas de verdade.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import type { WhatsAppConnection, WhatsAppConnectionStatus, WhatsAppDisconnectReason } from './types'

/** Colunas seguras — `api_key_enc` NUNCA entra aqui. */
const SAFE_COLUMNS =
  'tenant_id, service_tenant_slug, instance_name, connection_status, disconnect_reason, number_connected, connected_at, last_status_at'

interface ConnectionRow {
  tenant_id: string
  service_tenant_slug: string
  instance_name: string | null
  connection_status: string
  disconnect_reason: string | null
  number_connected: string | null
  connected_at: string | null
  last_status_at: string | null
}

function mapRow(row: ConnectionRow): WhatsAppConnection {
  return {
    tenantId: row.tenant_id,
    serviceTenantSlug: row.service_tenant_slug,
    instanceName: row.instance_name,
    status: row.connection_status as WhatsAppConnectionStatus,
    disconnectReason: row.disconnect_reason as WhatsAppDisconnectReason | null,
    numberConnected: row.number_connected,
    connectedAt: row.connected_at,
    lastStatusAt: row.last_status_at,
  }
}

/**
 * Estado da conexão de uma clínica. `null` = nunca conectou.
 * Projeção segura: não traz a credencial.
 */
export async function getWhatsAppConnection(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<WhatsAppConnection | null> {
  const { data, error } = await supabase
    .from('tenant_whatsapp_config')
    .select(SAFE_COLUMNS)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) throw new Error(`getWhatsAppConnection failed: ${error.message}`)
  if (!data) return null
  return mapRow(data as unknown as ConnectionRow)
}

/** Atalho para o motor de lembretes: a clínica pode enviar agora? */
export async function isWhatsAppConnected(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<boolean> {
  const conn = await getWhatsAppConnection(supabase, tenantId)
  return conn?.status === 'connected'
}

/**
 * Grava a credencial da clínica, cifrando antes de persistir.
 *
 * Só deve ser chamada logo após um provisionamento bem-sucedido no serviço.
 * `ON CONFLICT` atualiza a linha existente — reprovisionar não duplica.
 */
export async function saveWhatsAppCredentials(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    serviceTenantSlug: string
    apiKey: string
    /** Bearer que o serviço apresenta no callback de entrega (US4). */
    callbackSecret?: string | null
    createdByUserId?: string | null
  },
): Promise<void> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required to store the WhatsApp api key')
  }

  const cifrar = async (plain: string) => {
    const r = await supabase.rpc('enc_text_with_key', { plain, key })
    if (r.error || r.data === null || r.data === undefined) {
      throw new Error(`enc_text_with_key failed: ${r.error?.message ?? 'null ciphertext'}`)
    }
    return r.data as unknown as string
  }

  const payload: Database['public']['Tables']['tenant_whatsapp_config']['Insert'] = {
    tenant_id: args.tenantId,
    api_key_enc: await cifrar(args.apiKey),
    service_tenant_slug: args.serviceTenantSlug,
    connection_status: 'connecting',
    created_by_user_id: args.createdByUserId ?? null,
  }
  // Só sobrescreve o segredo quando o provisionamento devolveu um: uma
  // reconexão que não reprovisiona não pode apagar o que já está guardado.
  if (args.callbackSecret) payload.callback_secret_enc = await cifrar(args.callbackSecret)

  const { error } = await supabase
    .from('tenant_whatsapp_config')
    .upsert(payload, { onConflict: 'tenant_id' })
  if (error) throw new Error(`saveWhatsAppCredentials failed: ${error.message}`)
}

/**
 * Decifra o segredo do callback de entrega. Usado só pela rota de webhook,
 * para comparar com o Bearer apresentado — em tempo constante, no chamador.
 */
export async function getDecryptedCallbackSecret(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<string | null> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required')

  const { data, error } = await supabase
    .from('tenant_whatsapp_config')
    .select('callback_secret_enc')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`getDecryptedCallbackSecret failed: ${error.message}`)
  const cipher = (data as { callback_secret_enc?: string | null } | null)?.callback_secret_enc
  if (!cipher) return null

  const dec = await supabase.rpc('dec_text_with_key', { cipher, key })
  if (dec.error || dec.data === null || dec.data === undefined) {
    logger.error({ tenantId }, 'whatsapp-callback-secret-decrypt-failed')
    return null
  }
  return dec.data as unknown as string
}

/**
 * Decifra a `api_key` da clínica para uso imediato numa chamada ao serviço.
 *
 * O valor devolvido existe só em memória e NUNCA deve ser logado, devolvido em
 * resposta HTTP, nem guardado em estado de componente. Exige service-role (o
 * RLS não expõe `api_key_enc` a usuário autenticado).
 */
export async function getDecryptedApiKey(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<string | null> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required to read the WhatsApp api key')
  }

  const { data, error } = await supabase
    .from('tenant_whatsapp_config')
    .select('api_key_enc')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) throw new Error(`getDecryptedApiKey failed: ${error.message}`)
  const cipher = (data as { api_key_enc?: string } | null)?.api_key_enc
  if (!cipher) return null

  const dec = await supabase.rpc('dec_text_with_key', { cipher, key })
  if (dec.error || dec.data === null || dec.data === undefined) {
    // Sem detalhe do erro no log: a mensagem do Postgres pode ecoar o payload.
    logger.error({ tenantId }, 'whatsapp-api-key-decrypt-failed')
    return null
  }
  return dec.data as unknown as string
}

/**
 * Atualiza o estado espelhado da conexão. A fonte da verdade é o serviço; este
 * espelho existe para o cron não precisar de round-trip por lote.
 */
export async function updateConnectionState(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patch: {
    status: WhatsAppConnectionStatus
    instanceName?: string | null
    numberConnected?: string | null
    disconnectReason?: WhatsAppDisconnectReason | null
  },
): Promise<void> {
  const nowIso = new Date().toISOString()
  const update: Database['public']['Tables']['tenant_whatsapp_config']['Update'] = {
    connection_status: patch.status,
    last_status_at: nowIso,
    // FR-012a: o motivo só faz sentido enquanto NÃO está conectado.
    disconnect_reason: patch.status === 'connected' ? null : (patch.disconnectReason ?? null),
  }
  if (patch.instanceName !== undefined) update.instance_name = patch.instanceName
  if (patch.numberConnected !== undefined) update.number_connected = patch.numberConnected
  if (patch.status === 'connected') update.connected_at = nowIso

  const { error } = await supabase
    .from('tenant_whatsapp_config')
    .update(update)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`updateConnectionState failed: ${error.message}`)
}

/** Desvincula a clínica. O histórico de entrega é preservado (append-only). */
export async function deleteWhatsAppConnection(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<void> {
  const { error } = await supabase
    .from('tenant_whatsapp_config')
    .delete()
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`deleteWhatsAppConnection failed: ${error.message}`)
}
