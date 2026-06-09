import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { hashIpForTenant } from '@/lib/core/public-booking/ip-hash'
import {
  bumpRateLimit,
  checkRateLimit,
  RATE_LIMITS,
} from '@/lib/core/public-booking/rate-limit'
import { hashIpForPatientPortal, logPatientAccess } from './audit'

/**
 * Feature 030 — login leve do paciente (CPF + nascimento, FR-001/FR-002).
 *
 * Pipeline de segurança (auth fraca por decisão de produto ⇒ mitigações
 * OBRIGATÓRIAS):
 *   1. resolve a clínica pelo slug (server-side; tenant NUNCA vem do cliente)
 *   2. rate-limit por IP×clínica E por CPF×clínica (5/15min, FR-017)
 *   3. RPC `patient_portal_verify_login` (DEFINER) decifra e confere
 *   4. audit em `patient_portal_access_log` (login_ok / login_fail, FR-020)
 *
 * Falha é SEMPRE genérica: o resultado não distingue "CPF não existe" de
 * "nascimento errado" (FR-019) — a própria RPC retorna vazio nos dois casos
 * (e também com CPF duplicado/ambíguo ou paciente anonimizado).
 */

export interface PortalClinic {
  tenantId: string
  displayName: string
}

/**
 * Resolve a clínica do portal pelo slug público. O slug é a identidade
 * pública da clínica (compartilhado com o agendamento), mas o portal tem o
 * seu próprio liga/desliga: `patient_portal_enabled` (config 0114). Clínica
 * com o portal desabilitado NÃO resolve — login fica bloqueado.
 */
export async function resolvePortalClinicBySlug(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<PortalClinic | null> {
  const profile = await supabase
    .from('tenant_clinic_profile')
    .select('tenant_id, corporate_name, patient_portal_enabled')
    .eq('public_booking_slug', slug)
    .maybeSingle()
  if (profile.error || !profile.data) return null
  const row = profile.data as {
    tenant_id: string
    corporate_name: string | null
    patient_portal_enabled: boolean | null
  }
  // Liga/desliga do portal (FR/030 + 0114): desabilitado ⇒ não existe pra fora.
  if (!row.patient_portal_enabled) return null

  let displayName = row.corporate_name ?? ''
  if (!displayName) {
    const tenant = await supabase
      .from('tenants')
      .select('name')
      .eq('id', row.tenant_id)
      .maybeSingle()
    displayName = (tenant.data as { name: string } | null)?.name ?? slug
  }
  return { tenantId: row.tenant_id, displayName }
}

export type PatientLoginResult =
  | { status: 'ok'; patientId: string; tenantId: string; fullName: string }
  /** Credencial não casou — resposta genérica obrigatória (FR-019). */
  | { status: 'invalid' }
  | { status: 'rate_limited'; retryAfterSec: number }
  | { status: 'clinic_not_found' }

export interface VerifyPatientLoginInput {
  supabase: SupabaseClient<Database>
  slug: string
  /** CPF só dígitos (11). */
  cpf: string
  /** Nascimento só dígitos DDMMYYYY (8). */
  birthdate: string
  ip: string
  userAgent?: string | null
}

export async function verifyPatientLogin(
  input: VerifyPatientLoginInput,
): Promise<PatientLoginResult> {
  const { supabase, slug } = input

  const clinic = await resolvePortalClinicBySlug(supabase, slug)
  if (!clinic) return { status: 'clinic_not_found' }

  // Rate-limit duplo: por IP×clínica e por CPF×clínica (mesma tabela
  // append-only do booking; o "ip_hash" do segundo é o hash do CPF —
  // nunca o CPF em claro).
  const ipHash = hashIpForTenant(input.ip, slug)
  const cpfHash = hashIpForTenant(`cpf:${input.cpf}`, slug)
  const cfg = RATE_LIMITS.patient_login
  const [byIp, byCpf] = await Promise.all([
    checkRateLimit({
      supabase,
      tenantId: clinic.tenantId,
      ipHash,
      action: 'patient_login',
      limit: cfg.limit,
      windowSeconds: cfg.windowSeconds,
    }),
    checkRateLimit({
      supabase,
      tenantId: clinic.tenantId,
      ipHash: cpfHash,
      action: 'patient_login',
      limit: cfg.limit,
      windowSeconds: cfg.windowSeconds,
    }),
  ])
  if (!byIp.allowed || !byCpf.allowed) {
    return {
      status: 'rate_limited',
      retryAfterSec: Math.max(byIp.retryAfterSec, byCpf.retryAfterSec),
    }
  }

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY is required for patient portal login')

  const { data, error } = await supabase.rpc('patient_portal_verify_login' as never, {
    p_slug: slug,
    p_cpf: input.cpf,
    p_birthdate: input.birthdate,
    p_key: key,
  } as never)
  if (error) throw new Error(`patient_portal_verify_login failed: ${error.message}`)

  const rows = (data as unknown as Array<{
    patient_id: string
    tenant_id: string
    full_name: string
  }> | null) ?? []
  const match = rows[0]

  const auditIpHash = hashIpForPatientPortal(input.ip, clinic.tenantId)

  if (!match) {
    // Falha conta no rate-limit (só falhas consomem tentativas).
    await Promise.all([
      bumpRateLimit({ supabase, tenantId: clinic.tenantId, ipHash, action: 'patient_login' }),
      bumpRateLimit({ supabase, tenantId: clinic.tenantId, ipHash: cpfHash, action: 'patient_login' }),
      logPatientAccess({
        supabase,
        tenantId: clinic.tenantId,
        patientId: null,
        action: 'login_fail',
        ipHash: auditIpHash,
        userAgent: input.userAgent,
      }),
    ])
    return { status: 'invalid' }
  }

  await logPatientAccess({
    supabase,
    tenantId: clinic.tenantId,
    patientId: match.patient_id,
    action: 'login_ok',
    ipHash: auditIpHash,
    userAgent: input.userAgent,
  })

  return {
    status: 'ok',
    patientId: match.patient_id,
    tenantId: match.tenant_id,
    fullName: match.full_name,
  }
}
