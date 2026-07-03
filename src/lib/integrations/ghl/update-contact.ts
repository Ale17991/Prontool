import { logger } from '@/lib/observability/logger'
import { GHL_API_BASE } from './oauth/types'
import {
  buildCustomFieldsArray,
  buildHeaders,
  fetchWithRetry,
  type CreateContactInput,
} from './create-contact'

/**
 * Feature 008 — Outbound: atualiza contato no GHL via Bearer OAuth.
 * Reusa helpers do create-contact para custom_fields + headers.
 */

export interface UpdateContactInput extends Omit<CreateContactInput, 'locationId'> {
  contactId: string
}

export async function updateContactInGhl(input: UpdateContactInput): Promise<void> {
  const customFields = buildCustomFieldsArray(input.customFieldIds, input.patient)
  const body: Record<string, unknown> = {
    name: input.patient.fullName,
    ...(input.patient.email ? { email: input.patient.email } : {}),
    ...(input.patient.phone ? { phone: input.patient.phone } : {}),
    ...(customFields.length > 0 ? { customFields } : {}),
  }
  const url = `${GHL_API_BASE}/contacts/${encodeURIComponent(input.contactId)}`
  const res = await fetchWithRetry(url, {
    method: 'PUT',
    headers: buildHeaders(input.accessToken),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    logger.warn(
      { status: res.status, body: text.slice(0, 200), contact_id: input.contactId },
      'ghl-update-contact-failed',
    )
    throw new Error(`GHL PUT /contacts/${input.contactId} ${res.status}`)
  }
}
