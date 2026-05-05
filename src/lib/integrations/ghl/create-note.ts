import { logger } from '@/lib/observability/logger'
import { GHL_API_BASE } from './oauth/types'
import { buildHeaders, fetchWithRetry } from './create-contact'

/**
 * Feature 008 — Outbound: cria nota no contato GHL via Bearer OAuth direto.
 * Substitui o caminho legado via proxy Homio Operations.
 */

export interface CreateNoteInput {
  accessToken: string
  contactId: string
  body: string
}

export interface CreateNoteResult {
  ghlNoteId: string
}

export async function createNoteInGhl(
  input: CreateNoteInput,
): Promise<CreateNoteResult> {
  const url = `${GHL_API_BASE}/contacts/${encodeURIComponent(input.contactId)}/notes`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: buildHeaders(input.accessToken),
    body: JSON.stringify({ body: input.body }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    logger.warn(
      { status: res.status, body: text.slice(0, 200), contact_id: input.contactId },
      'ghl-create-note-failed',
    )
    throw new Error(`GHL POST /contacts/{id}/notes ${res.status}`)
  }
  const payload = (await res.json().catch(() => null)) as
    | { note?: { id?: string }; id?: string }
    | null
  const ghlNoteId = payload?.note?.id ?? payload?.id ?? ''
  return { ghlNoteId }
}
