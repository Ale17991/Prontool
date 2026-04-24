import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { DispatchResult } from '@/lib/integrations/types'
import { publishDomainEvent } from '@/lib/core/events/publish'

/**
 * Manual patient creation (admin/recepção flow). Encrypts PII locally, then
 * publishes `patient.created` to the event bus. Adapters (GHL etc.) decide
 * what to do with it; the bus returns per-provider dispatch results. In
 * standalone mode (no enabled integrations) the publish is a noop and
 * `integrations_dispatched` comes back empty — no outbound HTTP, no alerts.
 *
 * The local INSERT always succeeds if the encryption RPC succeeds — outbound
 * sync is best-effort. Failures in any adapter become `integration_sync_failed`
 * alerts emitted by the dispatcher.
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
  integrationsDispatched: DispatchResult[]
  /**
   * Back-compat: `true` iff the GHL adapter successfully created a contact.
   * Prefer reading `integrationsDispatched` in new code.
   */
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

  const inserted = await supabase
    .from('patients')
    .insert({
      tenant_id: input.tenantId,
      ghl_contact_id: null,
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

  const patientId = inserted.data.id

  const integrationsDispatched = await publishDomainEvent(supabase, input.tenantId, {
    type: 'patient.created',
    patient: {
      id: patientId,
      tenantId: input.tenantId,
      fullName: input.fullName,
      cpf: input.cpf,
      email: input.email ?? null,
      phone: input.phone ?? null,
      birthDate: input.birthDate ?? null,
      planId: input.planId ?? null,
      ghlContactId: null,
    },
  })

  // After fan-out, re-read ghl_contact_id — the GHL adapter writes it back
  // in its handleDomainEvent when the contact is created successfully.
  const reloaded = await supabase
    .from('patients')
    .select('ghl_contact_id')
    .eq('id', patientId)
    .single()
  const ghlContactId = (reloaded.data?.ghl_contact_id ?? null) as string | null
  const ghlResult = integrationsDispatched.find((d) => d.provider === 'ghl')
  const ghlSynced = Boolean(ghlResult?.ok && ghlContactId)

  return {
    patientId,
    integrationsDispatched,
    ghlSynced,
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
