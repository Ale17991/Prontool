import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError } from '@/lib/observability/errors'
import { updatePatientIdentity } from '@/lib/core/patients/update-identity'
import { updatePatientAddress } from '@/lib/core/patients/update-address'

const TOKEN_TTL_DAYS = 7

export interface IntakeContext {
  tenantId: string
  patientId: string
  clinicName: string
}

export interface IntakeSubmission {
  phone?: string | null
  email?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  address?: {
    cep?: string | null
    street?: string | null
    number?: string | null
    complement?: string | null
    neighborhood?: string | null
    city?: string | null
    state?: string | null
  }
}

/** Backlog 1/3 — gera token de auto-cadastro (link público, uso único). */
export async function createIntakeToken(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string; actorUserId: string },
): Promise<{ token: string }> {
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000).toISOString()
  const { error } = await supabase.from('patient_intake_tokens' as never).insert({
    tenant_id: args.tenantId,
    patient_id: args.patientId,
    token,
    expires_at: expiresAt,
    created_by: args.actorUserId,
  } as never)
  if (error) throw new Error(`createIntakeToken failed: ${error.message}`)
  return { token }
}

/** Valida o token (não usado, não expirado) e devolve contexto + nome da clínica. */
export async function resolveIntakeToken(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<IntakeContext | null> {
  const { data } = await supabase
    .from('patient_intake_tokens' as never)
    .select('tenant_id, patient_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle()
  const row = data as
    | { tenant_id: string; patient_id: string; expires_at: string; used_at: string | null }
    | null
  if (!row || row.used_at) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null

  const tenant = await supabase.from('tenants').select('name').eq('id', row.tenant_id).maybeSingle()
  return {
    tenantId: row.tenant_id,
    patientId: row.patient_id,
    clinicName: (tenant.data as { name?: string } | null)?.name ?? 'Clínica',
  }
}

const clean = (v: string | null | undefined): string | undefined => {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : undefined
}

/** Aplica os dados preenchidos pelo paciente e marca o token como usado. */
export async function submitIntake(
  supabase: SupabaseClient<Database>,
  token: string,
  sub: IntakeSubmission,
): Promise<void> {
  const ctx = await resolveIntakeToken(supabase, token)
  if (!ctx) throw new DomainError('INVALID_TOKEN', 'Link inválido ou expirado.', { status: 400 })

  // Só campos preenchidos (undefined = não altera; não limpa dado existente).
  await updatePatientIdentity(supabase, {
    tenantId: ctx.tenantId,
    patientId: ctx.patientId,
    fields: {
      phone: clean(sub.phone),
      email: clean(sub.email),
      emergencyContactName: clean(sub.emergencyContactName),
      emergencyContactPhone: clean(sub.emergencyContactPhone),
    },
  })

  if (sub.address) {
    const a = sub.address
    await updatePatientAddress(supabase, {
      tenantId: ctx.tenantId,
      patientId: ctx.patientId,
      address: {
        cep: clean(a.cep),
        street: clean(a.street),
        number: clean(a.number),
        complement: clean(a.complement),
        neighborhood: clean(a.neighborhood),
        city: clean(a.city),
        state: clean(a.state),
      },
    })
  }

  await supabase
    .from('patient_intake_tokens' as never)
    .update({ used_at: new Date().toISOString() } as never)
    .eq('token', token)
    .is('used_at', null)
}
