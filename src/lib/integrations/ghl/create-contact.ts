import { logger } from '@/lib/observability/logger'
import {
  GHL_API_BASE,
  GHL_API_VERSION,
  type GhlConfigV2,
} from './oauth/types'

/**
 * Feature 008 — Outbound: cria contato no GHL via Bearer OAuth direto
 * (substitui o caminho legado via proxy Homio Operations).
 *
 * Caller passa `accessToken` obtido por `withGhlAuth`. Em falha permanente
 * (4xx) lança `Error`; em falha transient (5xx/timeout) lança após 1 retry.
 * Adapter é responsável por capturar e gravar `recordSyncFailure`.
 */

const REQUEST_TIMEOUT_MS = 5_000

export interface CreateContactInput {
  accessToken: string
  locationId: string
  customFieldIds: GhlConfigV2['custom_field_ids']
  patient: {
    fullName: string
    email?: string | null
    phone?: string | null
    cpf?: string | null
    planoSaudeName?: string | null
    profissionalResponsavel?: string | null
    ultimoAtendimento?: string | null // ISO date
    diagnosticosAtivos?: string | null
    alergias?: string | null
  }
}

export interface CreateContactResult {
  ghlContactId: string
}

export async function createContactInGhl(
  input: CreateContactInput,
): Promise<CreateContactResult> {
  const customFields = buildCustomFieldsArray(input.customFieldIds, input.patient)

  const body = {
    locationId: input.locationId,
    name: input.patient.fullName,
    ...(input.patient.email ? { email: input.patient.email } : {}),
    ...(input.patient.phone ? { phone: input.patient.phone } : {}),
    ...(customFields.length > 0 ? { customFields } : {}),
    source: 'clinni',
  }

  const res = await fetchWithRetry(`${GHL_API_BASE}/contacts/`, {
    method: 'POST',
    headers: buildHeaders(input.accessToken),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    logger.warn(
      { status: res.status, body: text.slice(0, 200) },
      'ghl-create-contact-failed',
    )
    throw new Error(`GHL POST /contacts/ ${res.status}`)
  }

  const payload = (await res.json().catch(() => null)) as
    | { contact?: { id?: string }; id?: string }
    | null
  const ghlContactId = payload?.contact?.id ?? payload?.id
  if (!ghlContactId) throw new Error('GHL POST /contacts/ response missing contact id')
  return { ghlContactId }
}

export function buildCustomFieldsArray(
  ids: GhlConfigV2['custom_field_ids'],
  patient: CreateContactInput['patient'],
): Array<{ id: string; value: string }> {
  const map: Array<{ id?: string; value?: string | null }> = [
    { id: ids.cpf?.id, value: patient.cpf },
    { id: ids.plano_saude?.id, value: patient.planoSaudeName },
    { id: ids.profissional_responsavel?.id, value: patient.profissionalResponsavel },
    { id: ids.ultimo_atendimento?.id, value: patient.ultimoAtendimento },
    { id: ids.diagnosticos_ativos?.id, value: patient.diagnosticosAtivos },
    { id: ids.alergias?.id, value: patient.alergias },
  ]
  return map
    .filter((m): m is { id: string; value: string } => Boolean(m.id) && Boolean(m.value))
    .map((m) => ({ id: m.id, value: m.value }))
}

export function buildHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    Version: GHL_API_VERSION,
    'content-type': 'application/json',
    accept: 'application/json',
  }
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let attempt = 0
  while (true) {
    attempt += 1
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (res.status >= 500 && attempt === 1) {
        await sleep(250)
        continue
      }
      return res
    } catch (err) {
      if (attempt === 1) {
        await sleep(250)
        continue
      }
      throw err
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
