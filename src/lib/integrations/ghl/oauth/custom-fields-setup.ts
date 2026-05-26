import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { recordSyncSuccess, recordSyncFailure } from '@/lib/core/integrations/ghl/sync-log'
import { updateGhlConfig } from '@/lib/core/integrations/ghl/config-update'
import {
  GHL_API_BASE,
  GHL_API_VERSION,
  GHL_CUSTOM_FIELD_DEFINITIONS,
  GHL_CUSTOM_FIELD_SLUGS,
  type GhlConfigV2,
  type GhlCustomFieldDataType,
  type GhlCustomFieldSlug,
} from './types'

/**
 * Feature 008 — Setup pós-conexão de Custom Fields no GHL.
 *
 * Para cada um dos 6 slugs (cpf, plano_saude, ...): faz GET
 * `/custom-fields/?locationId=...`, decide:
 *   (a) match exato (name + dataType) → reusa o ID;
 *   (b) match só por name (tipo divergente) → cria novo com sufixo
 *       " (Clinni)" (Q2 da spec → opção C);
 *   (c) sem match → cria do zero.
 * Persiste mapa `custom_field_ids` em `tenant_integrations.config`.
 */

const REQUEST_TIMEOUT_MS = 5_000

interface RemoteCustomField {
  id: string
  name: string
  dataType?: string
  fieldKey?: string
}

export interface CustomFieldsSetupResult {
  /** IDs salvos por slug. Pode ficar parcial em caso de erro em alguns. */
  ids: GhlConfigV2['custom_field_ids']
  /** Avisos textuais para a UI (ex.: 'cpf:type_collision_suffixed'). */
  warnings: string[]
}

export async function customFieldsSetup(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  accessToken: string,
  locationId: string,
): Promise<CustomFieldsSetupResult> {
  const warnings: string[] = []
  const result: GhlConfigV2['custom_field_ids'] = {}

  let existing: RemoteCustomField[]
  try {
    existing = await listCustomFields(accessToken, locationId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(
      { tenant_id: tenantId, err: message },
      'ghl-custom-fields-list-failed',
    )
    await recordSyncFailure(supabase, tenantId, {
      kind: 'custom_field_setup',
      errorCode: 'LIST_FAILED',
      errorMessage: message,
    })
    return { ids: {}, warnings: ['custom_fields:list_failed'] }
  }

  for (const slug of GHL_CUSTOM_FIELD_SLUGS) {
    const def = GHL_CUSTOM_FIELD_DEFINITIONS[slug]
    try {
      const decision = decideCustomField(def, existing)
      let id: string
      if (decision.action === 'reuse') {
        id = decision.id
      } else {
        const name =
          decision.action === 'create_suffixed' ? `${def.name} (Clinni)` : def.name
        id = await createCustomField(accessToken, locationId, {
          name,
          dataType: def.dataType,
        })
        if (decision.action === 'create_suffixed') {
          warnings.push(`${slug}:type_collision_suffixed`)
        }
      }
      result[slug] = { id, alias: def.alias }
      await recordSyncSuccess(supabase, tenantId, {
        kind: 'custom_field_setup',
        detail: { slug, action: decision.action, id },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn(
        { tenant_id: tenantId, slug, err: message },
        'ghl-custom-field-setup-failed',
      )
      await recordSyncFailure(supabase, tenantId, {
        kind: 'custom_field_setup',
        errorCode: 'SETUP_FAILED',
        errorMessage: message,
        detail: { slug },
      })
      warnings.push(`${slug}:setup_failed`)
    }
  }

  if (Object.keys(result).length > 0) {
    await updateGhlConfig(supabase, tenantId, { custom_field_ids: result })
  }
  return { ids: result, warnings }
}

interface DecisionReuse {
  action: 'reuse'
  id: string
}
interface DecisionCreate {
  action: 'create' | 'create_suffixed'
}
type Decision = DecisionReuse | DecisionCreate

function decideCustomField(
  def: { name: string; dataType: GhlCustomFieldDataType },
  existing: RemoteCustomField[],
): Decision {
  const matchesByName = existing.filter(
    (e) => e.name.trim().toLowerCase() === def.name.trim().toLowerCase(),
  )
  if (matchesByName.length === 0) return { action: 'create' }

  // Já existe um campo com `dataType` correto → reusa.
  const exact = matchesByName.find((e) => normalizeType(e.dataType) === def.dataType)
  if (exact) return { action: 'reuse', id: exact.id }

  // Existe com nome igual mas tipo divergente — Q2:C → cria sufixado.
  // (Mas se já temos um sufixado anterior, reusa.)
  const suffixedName = `${def.name} (Clinni)`.toLowerCase()
  const existingSuffixed = existing.find(
    (e) =>
      e.name.trim().toLowerCase() === suffixedName &&
      normalizeType(e.dataType) === def.dataType,
  )
  if (existingSuffixed) return { action: 'reuse', id: existingSuffixed.id }
  return { action: 'create_suffixed' }
}

function normalizeType(remote: string | undefined): GhlCustomFieldDataType | string {
  if (!remote) return ''
  const upper = remote.toUpperCase()
  // Algumas APIs do GHL retornam TEXTAREA / TEXT_LARGE / LONG_TEXT como
  // sinônimos; consideramos LARGE_TEXT canônico aqui.
  if (upper === 'TEXTAREA' || upper === 'TEXT_LARGE' || upper === 'LONG_TEXT') {
    return 'LARGE_TEXT'
  }
  return upper
}

async function listCustomFields(
  accessToken: string,
  locationId: string,
): Promise<RemoteCustomField[]> {
  const res = await fetch(
    `${GHL_API_BASE}/locations/${encodeURIComponent(locationId)}/customFields`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GHL list customFields ${res.status}: ${text.slice(0, 200)}`)
  }
  const body = (await res.json().catch(() => null)) as
    | { customFields?: RemoteCustomField[] }
    | RemoteCustomField[]
    | null
  if (!body) return []
  if (Array.isArray(body)) return body
  return body.customFields ?? []
}

async function createCustomField(
  accessToken: string,
  locationId: string,
  field: { name: string; dataType: GhlCustomFieldDataType },
): Promise<string> {
  const res = await fetch(
    `${GHL_API_BASE}/locations/${encodeURIComponent(locationId)}/customFields`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: field.name,
        dataType: field.dataType,
        model: 'contact',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GHL create customField ${res.status}: ${text.slice(0, 200)}`)
  }
  const body = (await res.json().catch(() => null)) as
    | { id?: string; customField?: { id?: string } }
    | null
  const id = body?.id ?? body?.customField?.id
  if (!id) throw new Error(`GHL create customField returned no id`)
  return id
}
