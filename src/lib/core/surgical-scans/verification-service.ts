import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/** Token curto URL-safe (12 chars), sem dep externa. */
function shortToken(len = 12): string {
  return randomBytes(24).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, len)
}

/**
 * Gera (ou reaproveita) o token de verificação do atendimento. 1:1 por
 * (tenant, appointment) — UNIQUE garante idempotência.
 */
export async function generateVerificationToken(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentId: string,
): Promise<string> {
  const existing = await supabase
    .from('document_verification_tokens' as never)
    .select('token')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .maybeSingle()
  const found = (existing.data as { token?: string } | null)?.token
  if (found) return found

  const token = shortToken()
  const { error } = await supabase.from('document_verification_tokens' as never).insert({
    tenant_id: tenantId,
    appointment_id: appointmentId,
    token,
  } as never)
  if (error) {
    // Corrida: outro request criou — re-lê.
    const reread = await supabase
      .from('document_verification_tokens' as never)
      .select('token')
      .eq('tenant_id', tenantId)
      .eq('appointment_id', appointmentId)
      .maybeSingle()
    const t = (reread.data as { token?: string } | null)?.token
    if (t) return t
    throw new Error(`generateVerificationToken failed: ${error.message}`)
  }
  return token
}

export interface VerifyResult {
  valid: boolean
  issuedAt?: string
  clinicName?: string
}

/** Verificação PÚBLICA — não retorna dado de paciente. */
export async function verifyToken(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<VerifyResult> {
  const { data } = await supabase
    .from('document_verification_tokens' as never)
    .select('tenant_id, created_at')
    .eq('token', token)
    .maybeSingle()
  const row = data as { tenant_id: string; created_at: string } | null
  if (!row) return { valid: false }

  const tenant = await supabase.from('tenants').select('name').eq('id', row.tenant_id).maybeSingle()
  return {
    valid: true,
    issuedAt: row.created_at,
    clinicName: (tenant.data as { name?: string } | null)?.name ?? 'Clínica',
  }
}

export async function incrementVerification(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<void> {
  const { data } = await supabase
    .from('document_verification_tokens' as never)
    .select('verified_count')
    .eq('token', token)
    .maybeSingle()
  const current = (data as { verified_count?: number } | null)?.verified_count
  if (current === undefined || current === null) return
  await supabase
    .from('document_verification_tokens' as never)
    .update({ verified_count: current + 1, last_verified_at: new Date().toISOString() } as never)
    .eq('token', token)
}
