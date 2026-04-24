import { randomUUID } from 'node:crypto'
import { serviceClient } from './supabase-test-client'
import type { TenantRole } from '@/lib/db/types'

/** Common handle returned from seed builders. */
export interface SeededTenant {
  tenantId: string
  slug: string
}

export async function seedTenant(slug = `tenant-${randomUUID().slice(0, 8)}`): Promise<SeededTenant> {
  const sb = serviceClient()
  const tenantId = randomUUID()
  await sb
    .from('tenants')
    .insert({ id: tenantId, name: `Clínica ${slug}`, slug, status: 'active' })
    .throwOnError()
  return { tenantId, slug }
}

export async function seedUser(
  tenantId: string,
  role: TenantRole,
  emailPrefix = 'user',
): Promise<{ userId: string; email: string; role: TenantRole }> {
  const sb = serviceClient()
  const email = `${emailPrefix}-${randomUUID().slice(0, 6)}@test.local`
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: 'test1234',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)

  await sb
    .from('user_tenants')
    .insert({ user_id: data.user.id, tenant_id: tenantId, role })
    .throwOnError()
  return { userId: data.user.id, email, role }
}

export async function seedHealthPlan(tenantId: string, name = 'Unimode Teste'): Promise<string> {
  const sb = serviceClient()
  const id = randomUUID()
  await sb.from('health_plans').insert({ id, tenant_id: tenantId, name }).throwOnError()
  return id
}

export interface GhlConfigSeed {
  secret?: string
  triggerStageName?: string
  planoField?: string
  tussField?: string
  medicoField?: string
}

/**
 * Seeds a `tenant_ghl_config` row for tests. The `webhook_secret_enc` column
 * is BYTEA encrypted with the platform key; we rely on an `enc_text_with_key`
 * RPC (added by the test-helpers migration) to produce the ciphertext with
 * the same key the production handler uses to decrypt. Tests that run before
 * that migration lands will fail with a clear error pointing here.
 */
export interface GhlIntegrationSeed {
  locationId?: string
  operationsPat?: string
  inboundWebhookSecret?: string
  enabled?: boolean
}

/**
 * Seeds a `tenant_integrations` row (provider='ghl') for US3 tests.
 * Credentials are encrypted the same way the prod code expects.
 */
export async function seedGhlIntegration(
  tenantId: string,
  opts: GhlIntegrationSeed = {},
): Promise<void> {
  const sb = serviceClient()
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY not set')
  const credentials = {
    operations_pat: opts.operationsPat ?? 'pit-test-token',
    inbound_webhook_secret: opts.inboundWebhookSecret ?? 'a'.repeat(48),
  }
  const { data: credsEnc, error: credsErr } = await sb.rpc('enc_text_with_key', {
    plain: JSON.stringify(credentials),
    key,
  })
  if (credsErr) throw new Error(`enc credentials failed: ${credsErr.message}`)
  const { data: secretEnc, error: secretErr } = await sb.rpc('enc_text_with_key', {
    plain: credentials.inbound_webhook_secret,
    key,
  })
  if (secretErr) throw new Error(`enc webhook secret failed: ${secretErr.message}`)

  const { data: user } = await sb.auth.admin.listUsers()
  const createdBy = user?.users?.[0]?.id
  if (!createdBy) throw new Error('seedGhlIntegration: no auth user to attribute')

  await sb
    .from('tenant_integrations')
    .insert({
      tenant_id: tenantId,
      provider: 'ghl',
      config: {
        location_id: opts.locationId ?? 'abcTESTloc1234567890',
        trigger_stage_name: 'Pagamento confirmado',
        field_map_plano: 'plano',
        field_map_procedimento_tuss: 'tuss',
        field_map_profissional: 'medico',
        field_map_valor: 'valor',
      },
      credentials_enc: credsEnc as unknown as string,
      webhook_secret_enc: secretEnc as unknown as string,
      enabled: opts.enabled ?? true,
      created_by_user_id: createdBy,
    })
    .throwOnError()
}

export async function seedGhlConfig(tenantId: string, opts: GhlConfigSeed = {}): Promise<void> {
  const sb = serviceClient()
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY not set; seedGhlConfig cannot encrypt')
  const secret = opts.secret ?? 'test-webhook-secret'
  const { data: enc, error } = await sb.rpc('enc_text_with_key', { plain: secret, key })
  if (error)
    throw new Error(
      `seedGhlConfig: enc_text_with_key RPC missing or failed: ${error.message}. ` +
        'Ensure migration 0020_test_helpers.sql is applied.',
    )
  await sb
    .from('tenant_ghl_config')
    .insert({
      tenant_id: tenantId,
      webhook_secret_enc: enc as unknown as string,
      trigger_stage_name: opts.triggerStageName ?? 'atendimento',
      field_map_plano: opts.planoField ?? 'plano',
      field_map_procedimento_tuss: opts.tussField ?? 'tuss',
      field_map_medico_identifier: opts.medicoField ?? 'medico_id',
      field_map_patient_name: 'patient_name',
      field_map_patient_cpf: 'patient_cpf',
      field_map_patient_phone: 'patient_phone',
      field_map_patient_email: 'patient_email',
      field_map_patient_birth_date: 'patient_birth_date',
    })
    .throwOnError()
}

export async function seedTussCode(
  code: string,
  opts: {
    retired?: boolean
    tussTable?: '22' | '19' | '20'
    description?: string
    manufacturer?: string | null
  } = {},
): Promise<void> {
  const sb = serviceClient()
  const versionId = randomUUID()
  await sb
    .from('tuss_catalog_versions')
    .insert({ id: versionId, source_ref: 'seed', content_hash: 'test', code_count: 1 })
    .throwOnError()
  await sb
    .from('tuss_codes')
    .upsert(
      {
        code,
        description: opts.description ?? `Test procedure ${code}`,
        tuss_table: opts.tussTable ?? '22',
        manufacturer: opts.manufacturer ?? null,
        valid_from: '2020-01-01',
        valid_to: opts.retired ? '2020-12-31' : null,
        source_catalog_version_id: versionId,
      },
      { onConflict: 'code' },
    )
    .throwOnError()
}

export async function seedProcedure(tenantId: string, tussCode: string): Promise<string> {
  const sb = serviceClient()
  const id = randomUUID()
  await sb
    .from('procedures')
    .insert({ id, tenant_id: tenantId, tuss_code: tussCode })
    .throwOnError()
  return id
}

export async function seedDoctor(
  tenantId: string,
  opts: { crm?: string; bps?: number } = {},
): Promise<{ doctorId: string; commissionId: string }> {
  const sb = serviceClient()
  const doctorId = randomUUID()
  await sb
    .from('doctors')
    .insert({
      id: doctorId,
      tenant_id: tenantId,
      full_name: 'Dr. Teste',
      crm: opts.crm ?? `CRM-${randomUUID().slice(0, 5)}`,
    })
    .throwOnError()
  const commissionId = randomUUID()
  await sb
    .from('doctor_commission_history')
    .insert({
      id: commissionId,
      tenant_id: tenantId,
      doctor_id: doctorId,
      percentage_bps: opts.bps ?? 4000,
      valid_from: '2020-01-01',
      reason: 'initial',
    })
    .throwOnError()
  return { doctorId, commissionId }
}

export async function seedPriceVersion(args: {
  tenantId: string
  procedureId: string
  planId: string
  amountCents: number
  validFrom: string
  createdBy?: string
}): Promise<string> {
  const sb = serviceClient()
  const id = randomUUID()
  await sb
    .from('price_versions')
    .insert({
      id,
      tenant_id: args.tenantId,
      procedure_id: args.procedureId,
      plan_id: args.planId,
      amount_cents: args.amountCents,
      valid_from: args.validFrom,
      created_by: args.createdBy ?? randomUUID(),
      reason: 'seed',
    })
    .throwOnError()
  return id
}

export async function seedAppointment(args: {
  tenantId: string
  patientId: string
  doctorId: string
  procedureId: string
  planId: string
  priceVersionId: string
  commissionId: string
  amountCents: number
  commissionBps: number
  at?: string
}): Promise<string> {
  const sb = serviceClient()
  const id = randomUUID()
  await sb
    .from('appointments')
    .insert({
      id,
      tenant_id: args.tenantId,
      patient_id: args.patientId,
      doctor_id: args.doctorId,
      procedure_id: args.procedureId,
      plan_id: args.planId,
      frozen_amount_cents: args.amountCents,
      frozen_commission_bps: args.commissionBps,
      source_price_version_id: args.priceVersionId,
      source_commission_history_id: args.commissionId,
      appointment_at: args.at ?? new Date().toISOString(),
    })
    .throwOnError()
  return id
}

export async function seedPatient(tenantId: string): Promise<string> {
  const sb = serviceClient()
  const id = randomUUID()
  // Encryption keys must be set for this session.
  try {
    await sb.rpc('set_patient_encryption_key_for_test')
  } catch {
    // RPC optional; when absent, seed via a helper that sets SET LOCAL.
  }
  await sb
    .from('patients')
    .insert({
      id,
      tenant_id: tenantId,
      ghl_contact_id: `contact-${id}`,
      // Minimal encrypted stubs; tests that need decryption set the key first.
      full_name_enc: Buffer.from('stub') as unknown as string,
      cpf_enc: Buffer.from('stub') as unknown as string,
    })
    .throwOnError()
  return id
}
