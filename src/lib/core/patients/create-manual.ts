import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { dispatchAlert } from '@/lib/core/alerts/dispatcher'
import { createContactInGhl } from '@/lib/integrations/ghl/create-contact'
import { logger } from '@/lib/observability/logger'

/**
 * Manual patient creation (admin/recepção flow), independent of the GHL
 * webhook. Encrypts PII the same way as upsertPatientFromGhl, then tries
 * to mirror the contact into GHL via the Homio Operations proxy. Three
 * outcomes:
 *
 *   - GHL configured + OK   → patient saved with ghl_contact_id, ghlSynced=true
 *   - GHL configured + fail → patient saved with ghl_contact_id=NULL,
 *                             `ghl_sync_failed` alert dispatched, ghlSynced=false
 *   - GHL NOT configured    → patient saved with ghl_contact_id=NULL,
 *                             no alert (the environment simply has no proxy)
 *
 * The local save always succeeds if the encryption RPC succeeds — GHL sync
 * is best-effort. Caller can re-sync later (future: reconciliation job).
 */
export interface CreateManualPatientInput {
  tenantId: string
  fullName: string
  cpf: string
  phone?: string | undefined
  email?: string | undefined
  birthDate?: string | undefined
  /** Health plan chosen by the operator at creation time (obrigatório na UI; nullable no banco). */
  planId?: string | null | undefined
  actorUserId: string
}

export interface CreateManualPatientResult {
  patientId: string
  ghlSynced: boolean
  ghlContactId: string | null
}

export async function createPatientManually(
  supabase: SupabaseClient<Database>,
  input: CreateManualPatientInput,
): Promise<CreateManualPatientResult> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required to encrypt patient PII')

  const [name, cpf, phone, email, birthDate] = await Promise.all([
    encrypt(supabase, input.fullName, key),
    encrypt(supabase, input.cpf, key),
    input.phone ? encrypt(supabase, input.phone, key) : Promise.resolve(null),
    input.email ? encrypt(supabase, input.email, key) : Promise.resolve(null),
    input.birthDate ? encrypt(supabase, input.birthDate, key) : Promise.resolve(null),
  ])

  let ghlContactId: string | null = null
  let ghlConfigured = false
  let ghlError: unknown = null
  try {
    const out = await createContactInGhl({
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      source: 'homio-faturamento:manual',
    })
    if (out.configured) {
      ghlConfigured = true
      ghlContactId = out.ghlContactId
    }
  } catch (err) {
    ghlConfigured = true
    ghlError = err
    logger.warn(
      { tenantId: input.tenantId, err: (err as Error).message },
      'ghl-contact-create-threw',
    )
  }

  const inserted = await supabase
    .from('patients')
    .insert({
      tenant_id: input.tenantId,
      ghl_contact_id: ghlContactId,
      full_name_enc: name,
      cpf_enc: cpf,
      phone_enc: phone,
      email_enc: email,
      birth_date_enc: birthDate,
      plan_id: input.planId ?? null,
    })
    .select('id')
    .single()

  if (inserted.error || !inserted.data) {
    throw new Error(`createPatientManually insert failed: ${inserted.error?.message}`)
  }

  if (ghlConfigured && ghlError) {
    // Best-effort alert dispatch — don't fail the whole operation if the
    // alert insert itself breaks (already logged above).
    try {
      await dispatchAlert({
        tenantId: input.tenantId,
        type: 'ghl_sync_failed',
        subjectRef: { patient_id: inserted.data.id },
        detail: {
          route: 'createPatientManually',
          failure_reason: (ghlError as Error).message.slice(0, 200),
          action: 'create_contact',
        },
      })
    } catch (alertErr) {
      logger.error(
        { tenantId: input.tenantId, err: (alertErr as Error).message },
        'ghl-sync-failed-alert-dispatch-threw',
      )
    }
  }

  return {
    patientId: inserted.data.id,
    ghlSynced: ghlConfigured && ghlContactId !== null,
    ghlContactId,
  }
}

async function encrypt(
  supabase: SupabaseClient<Database>,
  plain: string,
  key: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('enc_text_with_key', { plain, key })
  if (error || data === null || data === undefined) {
    throw new Error(
      `enc_text_with_key RPC failed: ${error?.message ?? 'null ciphertext'}. ` +
        'Ensure migration 0020_test_helpers.sql is applied.',
    )
  }
  return data as unknown as string
}
