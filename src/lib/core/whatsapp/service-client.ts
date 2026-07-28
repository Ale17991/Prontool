/**
 * Feature 051 — Cliente HTTP do serviço de envio de WhatsApp.
 *
 * O serviço é um projeto Supabase separado (repo Homio-CRM/clinni-whatsapp) que
 * fala com a Evolution API. Contrato completo em
 * `specs/051-whatsapp-evolution/contracts/whatsapp-service.md`.
 *
 * SEGURANÇA
 * - `WHATSAPP_SERVICE_MASTER_KEY` é segredo de PLATAFORMA (provisiona clínicas),
 *   não credencial de tenant. Só `provisionTenant` a usa.
 * - A `api_key` de cada clínica é passada pelo caller, já decifrada em memória.
 *   Ela vive cifrada em `tenant_whatsapp_config.api_key_enc` — nunca em env.
 * - Nenhuma função deste arquivo loga telefone de paciente nem api_key.
 */

import { logger } from '@/lib/observability/logger'
import type {
  WhatsAppDisconnectReason,
  WhatsAppSendFailure,
  WhatsAppSendResult,
  WhatsAppServiceInstance,
} from './types'

const SEND_TIMEOUT_MS = 20_000
const CONNECT_TIMEOUT_MS = 30_000

function serviceUrl(): string {
  const url = process.env.WHATSAPP_SERVICE_URL
  if (!url) throw new Error('WHATSAPP_SERVICE_URL is required to reach the WhatsApp service')
  return url.replace(/\/+$/, '')
}

export function isWhatsAppServiceConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_SERVICE_URL)
}

async function call(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${serviceUrl()}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

// =========================================================================
// Provisionamento (master key — só a partir de ação admin no servidor)
// =========================================================================

export interface ProvisionResult {
  apiKey: string
  slug: string
  callbackSecret: string
}

/**
 * Cria (ou recupera) a clínica no serviço de envio. Idempotente por slug:
 * rechamar devolve o tenant existente SEM rotacionar a chave — importante,
 * porque rotacionar invalidaria a `api_key_enc` já gravada aqui.
 */
export async function provisionTenant(args: {
  slug: string
  name: string
  callbackUrl: string
}): Promise<ProvisionResult> {
  const masterKey = process.env.WHATSAPP_SERVICE_MASTER_KEY
  if (!masterKey) {
    throw new Error('WHATSAPP_SERVICE_MASTER_KEY is required to provision a clinic')
  }
  const { status, body } = await call(
    '/provision-tenant',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-master-key': masterKey },
      body: JSON.stringify(args),
    },
    CONNECT_TIMEOUT_MS,
  )
  if (status !== 200) {
    // Nunca logamos a master key nem o corpo cru (pode ecoar a api_key).
    logger.error({ slug: args.slug, status }, 'whatsapp-provision-failed')
    throw new Error(`WhatsApp provision failed with status ${status}`)
  }
  const b = body as Partial<ProvisionResult>
  if (!b.apiKey || !b.callbackSecret) {
    throw new Error('WhatsApp provision returned an incomplete payload')
  }
  return { apiKey: b.apiKey, slug: b.slug ?? args.slug, callbackSecret: b.callbackSecret }
}

// =========================================================================
// Conexão do número (api_key da clínica)
// =========================================================================

function tenantHeaders(apiKey: string): HeadersInit {
  return { 'Content-Type': 'application/json', 'x-api-key': apiKey }
}

/** Cria uma instância e devolve o QR em base64 (pode vir null se ainda não pronto). */
export async function createInstance(
  apiKey: string,
): Promise<{ instanceName: string | null; qrCode: string | null }> {
  const { status, body } = await call(
    '/create-instance',
    { method: 'POST', headers: tenantHeaders(apiKey), body: '{}' },
    CONNECT_TIMEOUT_MS,
  )
  if (status !== 200) throw new Error(`create-instance failed with status ${status}`)
  const b = body as { instance?: { evolution_name?: string }; qrCode?: string | null }
  return { instanceName: b.instance?.evolution_name ?? null, qrCode: b.qrCode ?? null }
}

/** Reconecta uma instância existente e devolve QR novo. */
export async function connectInstance(
  apiKey: string,
  instanceName: string,
): Promise<{ qrCode: string | null }> {
  const { status, body } = await call(
    '/connect-instance',
    {
      method: 'POST',
      headers: tenantHeaders(apiKey),
      body: JSON.stringify({ instanceName }),
    },
    CONNECT_TIMEOUT_MS,
  )
  if (status !== 200) throw new Error(`connect-instance failed with status ${status}`)
  return { qrCode: (body as { qrCode?: string | null }).qrCode ?? null }
}

/** Lista as instâncias da clínica com o estado ao vivo. */
export async function listInstances(apiKey: string): Promise<WhatsAppServiceInstance[]> {
  const { status, body } = await call(
    '/get-instances',
    { method: 'GET', headers: tenantHeaders(apiKey) },
    CONNECT_TIMEOUT_MS,
  )
  if (status !== 200) throw new Error(`get-instances failed with status ${status}`)
  const rows = (body as { instances?: unknown[] }).instances ?? []
  return rows.map((r) => {
    const row = r as {
      evolution_name?: string
      status?: string
      number_connected?: string | null
      disconnect_reason?: string | null
    }
    return {
      evolutionName: row.evolution_name ?? '',
      status: row.status ?? 'close',
      numberConnected: row.number_connected ?? null,
      disconnectReason: parseDisconnectReason(row.disconnect_reason),
    }
  })
}

export async function deleteInstance(apiKey: string, instanceName: string): Promise<void> {
  const { status } = await call(
    '/delete-instance',
    {
      method: 'POST',
      headers: tenantHeaders(apiKey),
      body: JSON.stringify({ instanceName }),
    },
    CONNECT_TIMEOUT_MS,
  )
  if (status !== 200) throw new Error(`delete-instance failed with status ${status}`)
}

/**
 * FR-012a — traduz o motivo cru vindo do serviço. Enquanto a T005a (captura do
 * motivo no braço) não estiver deployada, isto devolve `null` e a UI trata a
 * queda como desconexão comum, que é o comportamento seguro.
 */
function parseDisconnectReason(raw: string | null | undefined): WhatsAppDisconnectReason | null {
  if (!raw) return null
  const v = raw.toLowerCase()
  if (v.includes('blocked') || v.includes('banned') || v.includes('403')) return 'blocked'
  if (v.includes('logged_out') || v.includes('loggedout') || v.includes('401')) return 'logged_out'
  return 'unknown'
}

// =========================================================================
// Envio
// =========================================================================

/**
 * Dispara uma mensagem de texto. `externalId` é o id do registro em
 * `appointment_reminders` — é a chave de idempotência no serviço e a de
 * correlação no callback de status (D6).
 *
 * Não lança: devolve o resultado classificado, porque cada tipo de falha leva
 * a um desfecho diferente no motor de lembretes (ver `WhatsAppSendFailure`).
 */
export async function sendText(args: {
  apiKey: string
  to: string
  message: string
  externalId: string
}): Promise<WhatsAppSendResult> {
  try {
    const { status, body } = await call(
      '/send-message',
      {
        method: 'POST',
        headers: tenantHeaders(args.apiKey),
        body: JSON.stringify({
          to: args.to,
          message: args.message,
          externalId: args.externalId,
        }),
      },
      SEND_TIMEOUT_MS,
    )

    if (status === 200) {
      const id = (body as { messageId?: string }).messageId
      if (!id) return fail('send_failed', 'service returned 200 without messageId')
      return { ok: true, providerMessageId: id }
    }
    if (status === 401) return fail('unauthorized', 'invalid or inactive api key')
    if (status === 409) return fail('no_connection', 'no connected instance for this clinic')
    return fail('send_failed', `service responded ${status}`)
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError'
    // Retentativa é segura: o serviço deduplica por (tenant_id, external_id).
    return fail(isTimeout ? 'timeout' : 'send_failed', errText(err))
  }
}

function fail(kind: WhatsAppSendFailure, detail: string): WhatsAppSendResult {
  return { ok: false, kind, detail: detail.slice(0, 500) }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown-send-error'
}
