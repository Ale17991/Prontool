#!/usr/bin/env tsx
/**
 * T097 — Demo tenant seed used by `quickstart.md` Section 3.
 *
 * Creates (idempotently, by slug) a single demo tenant with the full
 * chain of objects a webhook needs to land as an appointment:
 *
 *   - tenant `clinica-demo`
 *   - admin user `admin@clinica-demo.test` / demo1234
 *   - recepcionista user `recepcao@clinica-demo.test` / demo1234
 *   - 3 TUSS catalog rows (local-only — the real catalog is seeded by
 *     `pnpm seed:tuss` against github.com/charlesfgarcia/tabelas-ans)
 *   - 3 procedures (one per TUSS)
 *   - 3 health plans: Unimed, Bradesco, Particular
 *   - 2 doctors with initial commissions (40% and 45%)
 *   - 5 price_versions spanning procedures × plans
 *   - tenant_ghl_config with webhook_secret='dev-shared-secret' and the
 *     default field map
 *
 * Safe to re-run — already-seeded rows are preserved via upsert or skipped.
 */
import { randomUUID } from 'node:crypto'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'

const DEMO = {
  tenant: { slug: 'clinica-demo', name: 'Clínica Demo' },
  webhookSecret: 'dev-shared-secret',
  users: [
    { email: 'admin@clinica-demo.test', password: 'demo1234', role: 'admin' as const },
    { email: 'recepcao@clinica-demo.test', password: 'demo1234', role: 'recepcionista' as const },
  ],
  tuss: [
    { code: '10101012', description: 'Consulta em consultório' },
    { code: '40101010', description: 'Procedimento diagnóstico A' },
    { code: '40101029', description: 'Procedimento diagnóstico B' },
  ],
  plans: ['Unimed', 'Bradesco', 'Particular'],
  doctors: [
    { full_name: 'Dra. Ana Silva', crm: 'CRM-12345', bps: 4000 },
    { full_name: 'Dr. Bruno Costa', crm: 'CRM-67890', bps: 4500 },
  ],
  priceMatrix: [
    { procedureIdx: 0, planIdx: 0, amount: 25_000 }, // Consulta × Unimed
    { procedureIdx: 0, planIdx: 1, amount: 28_000 }, // Consulta × Bradesco
    { procedureIdx: 0, planIdx: 2, amount: 40_000 }, // Consulta × Particular
    { procedureIdx: 1, planIdx: 2, amount: 80_000 }, // Proc A × Particular
    { procedureIdx: 2, planIdx: 0, amount: 55_000 }, // Proc B × Unimed
  ],
}

async function main() {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required to seed tenant_ghl_config')
  const sb = createSupabaseServiceClient()

  // --- tenant -----------------------------------------------------------
  const existingTenant = await sb
    .from('tenants')
    .select('id')
    .eq('slug', DEMO.tenant.slug)
    .maybeSingle()
  let tenantId = existingTenant.data?.id ?? null

  if (!tenantId) {
    const newId = randomUUID()
    await sb
      .from('tenants')
      .insert({ id: newId, slug: DEMO.tenant.slug, name: DEMO.tenant.name, status: 'active' })
      .throwOnError()
    tenantId = newId
    console.info(`[seed-demo] created tenant ${DEMO.tenant.slug} (${tenantId})`)
  } else {
    console.info(`[seed-demo] tenant ${DEMO.tenant.slug} already exists (${tenantId}); reusing`)
  }

  // --- users ------------------------------------------------------------
  let adminUserId: string | null = null
  for (const u of DEMO.users) {
    const existingUsers = await sb.auth.admin.listUsers()
    const found = existingUsers.data?.users.find((x) => x.email === u.email)
    let userId: string
    if (found) {
      userId = found.id
      console.info(`[seed-demo] user ${u.email} already exists; reusing`)
    } else {
      const created = await sb.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
      })
      if (created.error || !created.data.user) {
        throw new Error(`create user ${u.email} failed: ${created.error?.message}`)
      }
      userId = created.data.user.id
      console.info(`[seed-demo] created user ${u.email}`)
    }
    if (u.role === 'admin') adminUserId = userId
    await sb
      .from('user_tenants')
      .upsert(
        { user_id: userId, tenant_id: tenantId, role: u.role },
        { onConflict: 'user_id,tenant_id' },
      )
      .throwOnError()
  }
  if (!adminUserId) throw new Error('admin user id unresolved')

  // --- TUSS catalog (demo data only — real catalog lives in tuss_codes
  //     seeded from tabelas-ans via `pnpm seed:tuss`) -------------------
  const versionId = randomUUID()
  const existingVersion = await sb
    .from('tuss_catalog_versions')
    .select('id')
    .eq('source_ref', 'demo-seed')
    .maybeSingle()
  const catalogVersionId = existingVersion.data?.id ?? versionId
  if (!existingVersion.data) {
    await sb
      .from('tuss_catalog_versions')
      .insert({
        id: catalogVersionId,
        source_ref: 'demo-seed',
        content_hash: 'demo',
        code_count: DEMO.tuss.length,
      })
      .throwOnError()
  }
  for (const t of DEMO.tuss) {
    await sb
      .from('tuss_codes')
      .upsert(
        {
          code: t.code,
          description: t.description,
          valid_from: '2020-01-01',
          valid_to: null,
          source_catalog_version_id: catalogVersionId,
        },
        { onConflict: 'code' },
      )
      .throwOnError()
  }

  // --- procedures -------------------------------------------------------
  const procedureIds: string[] = []
  for (const t of DEMO.tuss) {
    const existing = await sb
      .from('procedures')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('tuss_code', t.code)
      .maybeSingle()
    if (existing.data) {
      procedureIds.push(existing.data.id)
      continue
    }
    const id = randomUUID()
    await sb
      .from('procedures')
      .insert({ id, tenant_id: tenantId, tuss_code: t.code })
      .throwOnError()
    procedureIds.push(id)
  }

  // --- health plans -----------------------------------------------------
  const planIds: string[] = []
  for (const name of DEMO.plans) {
    const existing = await sb
      .from('health_plans')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', name)
      .maybeSingle()
    if (existing.data) {
      planIds.push(existing.data.id)
      continue
    }
    const id = randomUUID()
    await sb.from('health_plans').insert({ id, tenant_id: tenantId, name }).throwOnError()
    planIds.push(id)
  }

  // --- doctors + commissions -------------------------------------------
  for (const d of DEMO.doctors) {
    const existing = await sb
      .from('doctors')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('crm', d.crm)
      .maybeSingle()
    let doctorId = existing.data?.id
    if (!doctorId) {
      doctorId = randomUUID()
      await sb
        .from('doctors')
        .insert({ id: doctorId, tenant_id: tenantId, full_name: d.full_name, crm: d.crm })
        .throwOnError()
    }
    const hasCommission = await sb
      .from('doctor_commission_history')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('doctor_id', doctorId)
      .limit(1)
      .maybeSingle()
    if (!hasCommission.data) {
      await sb
        .from('doctor_commission_history')
        .insert({
          tenant_id: tenantId,
          doctor_id: doctorId,
          percentage_bps: d.bps,
          valid_from: '2020-01-01',
          reason: 'demo-seed-initial',
        })
        .throwOnError()
    }
  }

  // --- prices ----------------------------------------------------------
  for (const p of DEMO.priceMatrix) {
    const procedureId = procedureIds[p.procedureIdx]
    const planId = planIds[p.planIdx]
    if (!procedureId || !planId) continue
    const existing = await sb
      .from('price_versions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('procedure_id', procedureId)
      .eq('plan_id', planId)
      .limit(1)
      .maybeSingle()
    if (existing.data) continue
    await sb
      .from('price_versions')
      .insert({
        tenant_id: tenantId,
        procedure_id: procedureId,
        plan_id: planId,
        amount_cents: p.amount,
        valid_from: '2020-01-01',
        reason: 'demo-seed',
        created_by: adminUserId,
      })
      .throwOnError()
  }

  // --- tenant_ghl_config -----------------------------------------------
  const configExists = await sb
    .from('tenant_ghl_config')
    .select('tenant_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!configExists.data) {
    const { data: enc, error: encErr } = await sb.rpc('enc_text_with_key', {
      plain: DEMO.webhookSecret,
      key,
    })
    if (encErr || !enc) throw new Error(`enc_text_with_key failed: ${encErr?.message}`)
    await sb
      .from('tenant_ghl_config')
      .insert({
        tenant_id: tenantId,
        webhook_secret_enc: enc as unknown as string,
        trigger_stage_name: 'atendimento',
        field_map_plano: 'plano',
        field_map_procedimento_tuss: 'tuss',
        field_map_medico_identifier: 'medico_id',
        field_map_patient_name: 'patient_name',
        field_map_patient_cpf: 'patient_cpf',
        field_map_patient_phone: 'patient_phone',
        field_map_patient_email: 'patient_email',
        field_map_patient_birth_date: 'patient_birth_date',
      })
      .throwOnError()
  }

  console.info('[seed-demo] done.')
  console.info(`  tenant slug: ${DEMO.tenant.slug}`)
  console.info(`  admin login: admin@clinica-demo.test / demo1234`)
  console.info(`  webhook_secret: ${DEMO.webhookSecret}`)
}

main().catch((err: unknown) => {
  console.error('[seed-demo] FAILED:', err)
  process.exit(1)
})
