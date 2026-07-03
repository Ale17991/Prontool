/**
 * Feature 017 — Rate limit por IP-hash + tenant + action.
 *
 * Tabela `public_booking_rate_limits` é append-only. `checkRateLimit`
 * conta requests no janela; `bumpRateLimit` insere o registro do uso
 * que acabou de acontecer. Retorna `retryAfterSec` baseado na request
 * mais antiga no janela (para Retry-After header).
 *
 * Limites canônicos (US3):
 * - view_slots: 10/min
 * - submit:     5/h
 * - cancel:     5/h
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export type RateLimitAction = 'view_slots' | 'submit' | 'cancel' | 'patient_login'

export interface CheckRateLimitInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  ipHash: string
  action: RateLimitAction
  limit: number
  windowSeconds: number
}

export interface CheckRateLimitResult {
  allowed: boolean
  /** Segundos até liberar 1 slot (~ até a request mais antiga sair da janela). */
  retryAfterSec: number
  /** Quantos requests no janela (informativo). */
  used: number
}

export async function checkRateLimit(input: CheckRateLimitInput): Promise<CheckRateLimitResult> {
  const since = new Date(Date.now() - input.windowSeconds * 1000).toISOString()
  const { data, error } = await input.supabase
    .from('public_booking_rate_limits')
    .select('created_at')
    .eq('tenant_id', input.tenantId)
    .eq('ip_hash', input.ipHash)
    .eq('action', input.action)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
  if (error) {
    // Se DB falhar, abrir o acesso é o mal menor (vs negar todo mundo).
    return { allowed: true, retryAfterSec: 0, used: 0 }
  }
  const used = (data ?? []).length
  if (used < input.limit) {
    return { allowed: true, retryAfterSec: 0, used }
  }
  const oldest = data?.[0]?.created_at
  let retryAfterSec = input.windowSeconds
  if (oldest) {
    const oldestMs = new Date(oldest).getTime()
    const passed = (Date.now() - oldestMs) / 1000
    retryAfterSec = Math.max(1, Math.ceil(input.windowSeconds - passed))
  }
  return { allowed: false, retryAfterSec, used }
}

export interface BumpRateLimitInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  ipHash: string
  action: RateLimitAction
}

export async function bumpRateLimit(input: BumpRateLimitInput): Promise<void> {
  const { error } = await input.supabase.from('public_booking_rate_limits').insert({
    tenant_id: input.tenantId,
    ip_hash: input.ipHash,
    action: input.action,
  } as never)
  if (error) {
    // Best-effort: rate limit log não pode quebrar a request principal.
    // O contador só fica sub-contado neste request específico.
  }
}

export const RATE_LIMITS: Record<RateLimitAction, { limit: number; windowSeconds: number }> = {
  view_slots: { limit: 10, windowSeconds: 60 },
  // submit: anti-spam por IP×clínica. O slot lock (appointment_slot_locks +
  // SLOT_NO_LONGER_AVAILABLE) já impede duplo agendamento do MESMO horário, mas
  // não impede um atacante encher horários distintos com bookings falsos — daí
  // o limite. 5/h é folgado p/ um paciente real (que agenda 1x) e corta abuso.
  submit: { limit: 5, windowSeconds: 60 * 60 },
  cancel: { limit: 5, windowSeconds: 60 * 60 },
  // Feature 030 — login do portal do paciente (auth fraca CPF+nascimento):
  // 5 tentativas falhas / 15 min, contadas por IP×clínica E por CPF×clínica.
  patient_login: { limit: 5, windowSeconds: 15 * 60 },
}
