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
  inboundWebhookSecret?: string
  enabled?: boolean
  /**
   * Mapas opcionais de IDs já registrados (custom fields / webhooks /
   * menu) — para tests que não exercitam post-connect-setup.
   */
  customFieldIds?: Record<string, { id: string; alias: string }>
  webhookIds?: Record<string, string>
}

/**
 * Seeds a `tenant_integrations` row (provider='ghl') no formato OAuth 2.0
 * (Feature 008). Tokens são preenchidos com valores fake longos o
 * bastante pra passar nos schemas. Tests que precisam que o token expire
 * podem chamar `setExpiresAt` (ver `auto-refresh.spec.ts`).
 */
export async function seedGhlIntegration(
  tenantId: string,
  opts: GhlIntegrationSeed = {},
): Promise<void> {
  const sb = serviceClient()
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY not set')
  const locationId = opts.locationId ?? 'loc_test_seed'
  const credentials = {
    access_token: 'at_seed_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    refresh_token: 'rt_seed_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    scopes: ['contacts.readonly', 'contacts.write'],
    user_type: 'Location' as const,
    location_id: locationId,
    company_id: 'comp_seed',
    user_id: 'usr_seed',
  }
  const { data: credsEnc, error: credsErr } = await sb.rpc('enc_text_with_key', {
    plain: JSON.stringify(credentials),
    key,
  })
  if (credsErr) throw new Error(`enc credentials failed: ${credsErr.message}`)

  const inboundSecret = opts.inboundWebhookSecret ?? 'a'.repeat(48)
  const { data: secretEnc, error: secretErr } = await sb.rpc('enc_text_with_key', {
    plain: inboundSecret,
    key,
  })
  if (secretErr) throw new Error(`enc webhook secret failed: ${secretErr.message}`)

  const { data: user } = await sb.auth.admin.listUsers()
  const createdBy = user?.users?.[0]?.id ?? null

  await sb
    .from('tenant_integrations')
    .insert({
      tenant_id: tenantId,
      provider: 'ghl',
      config: {
        location_id: locationId,
        sub_account_name: 'Clínica Seed',
        timezone: 'America/Sao_Paulo',
        custom_field_ids: opts.customFieldIds ?? {},
        webhook_ids: opts.webhookIds ?? {},
        menu_id: null,
        menu_status: 'not_attempted',
      },
      credentials_enc: credsEnc as unknown as string,
      webhook_secret_enc: secretEnc as unknown as string,
      enabled: opts.enabled ?? true,
      status: 'connected',
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

  // Mirror into tenant_integrations so inbound-webhook (now handled by the
  // GHL adapter reading from the new table) sees the same secret. Parallels
  // the INSERT path in migration 0040 for already-connected tenants.
  let { data: users } = await sb.auth.admin.listUsers()
  let createdBy = users?.users?.[0]?.id
  if (!createdBy) {
    // Tests that invoke seedGhlConfig before any seedUser need an auth user
    // for the NOT NULL created_by_user_id column. Mint a throwaway one.
    const { data, error } = await sb.auth.admin.createUser({
      email: `system-seed-${randomUUID().slice(0, 6)}@test.local`,
      password: 'test1234',
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(`seedGhlConfig: auth user bootstrap failed`)
    createdBy = data.user.id
  }
  if (createdBy) {
    const { data: credsEnc } = await sb.rpc('enc_text_with_key', {
      plain: JSON.stringify({ operations_pat: 'seed-pat-token', inbound_webhook_secret: secret }),
      key,
    })
    await sb
      .from('tenant_integrations')
      .upsert(
        {
          tenant_id: tenantId,
          provider: 'ghl',
          config: {
            location_id: 'seedTESTloc123456789',
            trigger_stage_name: opts.triggerStageName ?? 'atendimento',
            field_map_plano: opts.planoField ?? 'plano',
            field_map_procedimento_tuss: opts.tussField ?? 'tuss',
            field_map_profissional: opts.medicoField ?? 'medico_id',
            field_map_valor: 'valor',
          },
          credentials_enc: credsEnc as unknown as string,
          webhook_secret_enc: enc as unknown as string,
          enabled: true,
          created_by_user_id: createdBy,
        },
        { onConflict: 'tenant_id,provider' },
      )
      .throwOnError()
  }
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

/**
 * Feature 029/031 — entrada de domínio TISS (catálogo global, sem tenant).
 * `tiss_domain_tables` é preservada por `test_truncate_all_mutable`, mas não é
 * semeada por ele; tests que dependem de um domínio devem garanti-lo aqui.
 */
export async function seedTissDomainEntry(
  domainNumber: string,
  code: string,
  description: string,
  opts: { validFrom?: string; validTo?: string | null } = {},
): Promise<void> {
  const sb = serviceClient()
  await sb
    .from('tiss_domain_tables')
    .upsert(
      {
        domain_number: domainNumber,
        code,
        description,
        valid_from: opts.validFrom ?? '2000-01-01',
        valid_to: opts.validTo ?? null,
      },
      { onConflict: 'domain_number,code,valid_from' },
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
  opts: {
    crm?: string
    bps?: number
    paymentMode?: 'comissionado' | 'fixo' | 'liberal'
    monthlyAmountCents?: number
    billingDay?: number
    liberalDefaultCents?: number
  } = {},
): Promise<{ doctorId: string; commissionId: string }> {
  const sb = serviceClient()
  const doctorId = randomUUID()
  const mode = opts.paymentMode ?? 'comissionado'
  await sb
    .from('doctors')
    .insert({
      id: doctorId,
      tenant_id: tenantId,
      full_name: 'Dr. Teste',
      crm: opts.crm ?? `CRM-${randomUUID().slice(0, 5)}`,
      payment_mode: mode,
    } as never)
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
  // Feature 013 — invariant: cada doctor tem >=1 row em payment_terms_history.
  await sb
    .from('doctor_payment_terms_history' as never)
    .insert({
      tenant_id: tenantId,
      doctor_id: doctorId,
      payment_mode: mode,
      percentage_bps: mode === 'comissionado' ? (opts.bps ?? 4000) : null,
      monthly_amount_cents: mode === 'fixo' ? (opts.monthlyAmountCents ?? 800000) : null,
      billing_day: mode === 'fixo' ? (opts.billingDay ?? 1) : null,
      liberal_default_cents: mode === 'liberal' ? (opts.liberalDefaultCents ?? 35000) : null,
      valid_from: '2020-01-01',
      reason: 'seedDoctor — test fixture',
      created_by: '00000000-0000-0000-0000-000000000000',
    } as never)
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

/**
 * Feature 031 — linha de `appointment_procedures` (alvo do vínculo de
 * participantes). Por padrão cria uma linha PARTICULAR (plan_id NULL,
 * source_price_version_id NULL) para satisfazer o trigger de price-coherence
 * sem precisar de price_version. Passe `planId` + `priceVersionId` para uma
 * linha de convênio.
 */
export async function seedAppointmentProcedure(args: {
  tenantId: string
  appointmentId: string
  procedureId: string // procedures.id
  planId?: string | null
  priceVersionId?: string | null
  lineAmountCents?: number
  sequence?: number
  createdBy?: string
}): Promise<string> {
  const sb = serviceClient()
  const id = randomUUID()
  const amount = args.lineAmountCents ?? 20000
  await sb
    .from('appointment_procedures')
    .insert({
      id,
      tenant_id: args.tenantId,
      appointment_id: args.appointmentId,
      procedure_id: args.procedureId,
      plan_id: args.planId ?? null,
      source_price_version_id: args.priceVersionId ?? null,
      line_amount_cents: amount,
      vigente_amount_cents: amount,
      amount_was_overridden: false,
      sequence: args.sequence ?? 1,
      created_by: args.createdBy ?? '00000000-0000-0000-0000-000000000000',
    } as never)
    .throwOnError()
  return id
}

/**
 * Marca um atendimento como REALIZADO inserindo `appointment_completions`,
 * o que faz `appointments_effective.effective_status` virar 'ativo' (0096) —
 * pré-condição para entrar no repasse (gross/commission e participações).
 */
export async function seedAppointmentCompletion(args: {
  tenantId: string
  appointmentId: string
  completedBy?: string
}): Promise<void> {
  const sb = serviceClient()
  await sb
    .from('appointment_completions' as never)
    .insert({
      tenant_id: args.tenantId,
      appointment_id: args.appointmentId,
      completed_by: args.completedBy ?? '00000000-0000-0000-0000-000000000000',
      source: 'manual',
    } as never)
    .throwOnError()
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

/**
 * Feature 030 — perfil da clínica com slug público (portal do paciente /
 * agendamento). Todas as colunas além de tenant_id são nullable.
 */
export async function seedClinicProfile(
  tenantId: string,
  opts: { slug: string; corporateName?: string; publicBookingEnabled?: boolean },
): Promise<void> {
  const sb = serviceClient()
  await sb
    .from('tenant_clinic_profile')
    .upsert({
      tenant_id: tenantId,
      corporate_name: opts.corporateName ?? 'Clínica Teste 030',
      public_booking_slug: opts.slug,
      public_booking_enabled: opts.publicBookingEnabled ?? false,
    })
    .throwOnError()
}

/**
 * Feature 030 — paciente com PII REAL cifrada (CPF/nascimento/nome) via
 * enc_text_with_key, para testes de login do portal. birthDate em
 * 'YYYY-MM-DD' (mesmo formato do app).
 */
export async function seedPatientWithPii(
  tenantId: string,
  opts: { cpf: string; birthDate: string; fullName?: string },
): Promise<string> {
  const sb = serviceClient()
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY not set')
  const enc = async (plain: string): Promise<string> => {
    const { data, error } = await sb.rpc('enc_text_with_key', { plain, key })
    if (error || data == null) throw new Error(`enc_text_with_key failed: ${error?.message}`)
    return data as unknown as string
  }
  const id = randomUUID()
  await sb
    .from('patients')
    .insert({
      id,
      tenant_id: tenantId,
      ghl_contact_id: `contact-${id}`,
      full_name_enc: await enc(opts.fullName ?? 'Paciente Portal Teste'),
      cpf_enc: await enc(opts.cpf),
      birth_date_enc: await enc(opts.birthDate),
    })
    .throwOnError()
  return id
}
