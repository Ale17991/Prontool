/**
 * Helpers E2E da Memed (spec 027) — usados pelos memed-*.spec.ts rodando via
 * `pnpm test:e2e:memed` (playwright.memed.config.ts).
 *
 * Seeds são feitos direto no banco local (service role) contra o tenant demo,
 * espelhando tests/helpers/memed-mock.ts. O prescritor também é registrado no
 * mock HTTP (:4001) para o GET de token funcionar de ponta a ponta.
 *
 * Imports relativos (sem `@/`) — Playwright não resolve tsconfig paths aqui.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { loadEnv, serviceClient, getDemoTenantId, DEMO_ADMIN } from './fixtures'

export const MOCK_BASE = 'http://localhost:4001'

/** URL real do SDK Sinapse — interceptada e respondida com o stub. */
export const MEMED_SDK_URL_GLOB =
  'https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/**'

export interface MemedE2eFixture {
  tenantId: string
  adminUserId: string
  doctorId: string
  patientId: string
  patientName: string
  appointmentId: string
  /** Segundo médico SEM prescritor — usado pelo full-flow para habilitar via API. */
  doctor2Id: string
  appointment2Id: string
}

async function encrypt(sb: ReturnType<typeof serviceClient>, plain: string): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY missing from .env.local')
  const { data, error } = await sb.rpc('enc_text_with_key', { plain, key })
  if (error || data == null) throw new Error(`enc_text_with_key failed: ${error?.message}`)
  return data as unknown as string
}

async function findAdminUserId(sb: ReturnType<typeof serviceClient>): Promise<string> {
  const { data } = await sb.auth.admin.listUsers()
  const admin = data?.users.find((u) => u.email === DEMO_ADMIN.email)
  if (!admin) throw new Error('demo admin not found — run pnpm seed:demo')
  return admin.id
}

/** Insere um médico com TODOS os campos de prescritor (espelha seedDoctor). */
async function seedPrescriberDoctor(
  sb: ReturnType<typeof serviceClient>,
  tenantId: string,
  fullName: string,
): Promise<{ doctorId: string; commissionId: string }> {
  const doctorId = randomUUID()
  await sb
    .from('doctors')
    .insert({
      id: doctorId,
      tenant_id: tenantId,
      full_name: fullName,
      crm: `CRM-${randomUUID().slice(0, 5)}`,
      payment_mode: 'comissionado',
      cpf: '52998224725',
      council_name: 'CRM',
      council_number: '123456',
      council_state: 'SP',
      birth_date: '1980-05-10',
    } as never)
    .throwOnError()
  const commissionId = randomUUID()
  await sb
    .from('doctor_commission_history')
    .insert({
      id: commissionId,
      tenant_id: tenantId,
      doctor_id: doctorId,
      percentage_bps: 4000,
      valid_from: '2020-01-01',
      reason: 'e2e memed',
    })
    .throwOnError()
  await sb
    .from('doctor_payment_terms_history' as never)
    .insert({
      tenant_id: tenantId,
      doctor_id: doctorId,
      payment_mode: 'comissionado',
      percentage_bps: 4000,
      valid_from: '2020-01-01',
      reason: 'e2e memed',
      created_by: '00000000-0000-0000-0000-000000000000',
    } as never)
    .throwOnError()
  return { doctorId, commissionId }
}

/** Paciente com PII completa (nome/CPF/celular/e-mail/nascimento cifrados). */
async function seedFullPatient(
  sb: ReturnType<typeof serviceClient>,
  tenantId: string,
  fullName: string,
): Promise<string> {
  const id = randomUUID()
  await sb
    .from('patients')
    .insert({
      id,
      tenant_id: tenantId,
      ghl_contact_id: null,
      full_name_enc: await encrypt(sb, fullName),
      cpf_enc: await encrypt(sb, '39053344705'),
      phone_enc: await encrypt(sb, '(11) 98888-0000'),
      email_enc: await encrypt(sb, 'paciente.memed.e2e@test.local'),
      birth_date_enc: await encrypt(sb, '1992-07-21'),
    } as never)
    .throwOnError()
  return id
}

async function seedAppointmentFor(
  sb: ReturnType<typeof serviceClient>,
  args: { tenantId: string; patientId: string; doctorId: string; commissionId: string },
): Promise<string> {
  // Reusa procedimento/plano/preço do seed demo — qualquer price_version serve.
  const { data: pv, error } = await sb
    .from('price_versions')
    .select('id, procedure_id, plan_id, amount_cents')
    .eq('tenant_id', args.tenantId)
    .limit(1)
    .maybeSingle()
  if (error || !pv) throw new Error('demo price_versions não encontrado — run pnpm seed:demo')
  const id = randomUUID()
  await sb
    .from('appointments')
    .insert({
      id,
      tenant_id: args.tenantId,
      patient_id: args.patientId,
      doctor_id: args.doctorId,
      procedure_id: pv.procedure_id,
      plan_id: pv.plan_id,
      frozen_amount_cents: pv.amount_cents,
      frozen_commission_bps: 4000,
      source_price_version_id: pv.id,
      source_commission_history_id: args.commissionId,
      appointment_at: new Date().toISOString(),
    })
    .throwOnError()
  return id
}

/** Registra o external_id no mock da Memed (necessário para o GET de token). */
export async function registerOnMock(externalId: string): Promise<void> {
  const res = await fetch(`${MOCK_BASE}/__register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ external_id: externalId }),
  })
  if (!res.ok) throw new Error(`mock /__register falhou: ${res.status}`)
}

/**
 * Monta o cenário completo da Memed no tenant demo. Idempotente por execução
 * (ids randômicos); estado antigo de execuções anteriores não interfere.
 */
export async function seedMemedFixture(): Promise<MemedE2eFixture> {
  loadEnv()
  const sb = serviceClient()
  const tenantId = await getDemoTenantId(sb)
  const adminUserId = await findAdminUserId(sb)

  // Config da clínica: ativada em staging (chaves são de plataforma/env).
  // Upsert — execuções anteriores podem ter deixado a linha.
  await sb
    .from('tenant_memed_config')
    .upsert(
      {
        tenant_id: tenantId,
        environment: 'staging',
        connected: true,
        terms_accepted_at: new Date().toISOString(),
        terms_accepted_by: adminUserId,
        created_by_user_id: adminUserId,
      } as never,
      { onConflict: 'tenant_id' },
    )
    .throwOnError()

  const { doctorId, commissionId } = await seedPrescriberDoctor(
    sb,
    tenantId,
    'Dr. Memed E2E Prescritor',
  )
  const { doctorId: doctor2Id, commissionId: commission2Id } = await seedPrescriberDoctor(
    sb,
    tenantId,
    'Dra. Memed E2E FullFlow',
  )

  // doctor1 já entra registrado (banco + mock); doctor2 fica para o full-flow
  // habilitar pela rota real (que faz POST /usuarios no mock).
  await sb
    .from('memed_prescribers')
    .upsert(
      {
        tenant_id: tenantId,
        doctor_id: doctorId,
        external_id: doctorId,
        status: 'registered',
        created_by_user_id: adminUserId,
      } as never,
      { onConflict: 'tenant_id,doctor_id' },
    )
    .throwOnError()
  await registerOnMock(doctorId)

  const patientName = 'Paciente Memed E2E'
  const patientId = await seedFullPatient(sb, tenantId, patientName)
  const appointmentId = await seedAppointmentFor(sb, {
    tenantId,
    patientId,
    doctorId,
    commissionId,
  })
  const appointment2Id = await seedAppointmentFor(sb, {
    tenantId,
    patientId,
    doctorId: doctor2Id,
    commissionId: commission2Id,
  })

  return {
    tenantId,
    adminUserId,
    doctorId,
    patientId,
    patientName,
    appointmentId,
    doctor2Id,
    appointment2Id,
  }
}

const SDK_STUB_BODY = readFileSync(
  join(process.cwd(), 'tests', 'mocks', 'memed-sdk-stub.js'),
  'utf8',
)

/**
 * Intercepta a URL do SDK real da Memed e responde com o stub local — o
 * launcher de produção roda inalterado, só o script externo é substituído.
 */
export async function stubMemedSdk(page: Page): Promise<void> {
  await page.route(MEMED_SDK_URL_GLOB, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: SDK_STUB_BODY,
    }),
  )
}

/**
 * Abre o atendimento, clica "Prescrever" e espera o iframe stub carregar com o
 * paciente correto. Retorna o tempo (ms) entre o clique e o paciente visível.
 */
export async function openPrescription(
  page: Page,
  appointmentId: string,
  patientName: string,
): Promise<number> {
  await page.goto(`/operacao/atendimentos/${appointmentId}`, { waitUntil: 'networkidle' })
  const button = page.getByRole('button', { name: /^prescrever$/i })
  await button.waitFor({ state: 'visible' })
  const startedAt = Date.now()
  await button.click()
  const frame = page.frameLocator('#memed-iframe-stub')
  // 60s: o primeiro hit num dev server frio compila página + 2 rotas de API.
  await frame.locator('#paciente-nome').filter({ hasText: patientName }).waitFor({
    state: 'visible',
    timeout: 60_000,
  })
  return Date.now() - startedAt
}
