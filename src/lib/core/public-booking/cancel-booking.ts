/**
 * Feature 017 — Cancela appointment via token público (sem login).
 *
 * Pipeline:
 *   1. Hash do token raw
 *   2. SELECT em public_booking_tokens (não-usado, não-expirado, action=cancel)
 *   3. Valida tenant + carrega appointment (incluindo frozen_amount_cents)
 *   4. Valida janela de cancelamento (cancel_min_hours antes do horário)
 *   5. INSERT em appointment_reversals (reversal_amount_cents = -frozen)
 *      → trigger automaticamente libera appointment_slot_locks
 *   6. UPDATE public_booking_tokens.used_at = now()
 *   7. INSERT audit_log via log_audit_event (event_type='public_booking_cancelled')
 *   8. Pós-commit: bell notification para admins + opcional email confirmação
 *
 * Constituição:
 * - I (imutabilidade): NÃO faz UPDATE em appointments.status — cria reversal
 * - II (audit): trigger automático + log explícito
 * - III (multi-tenant): tenant_id resolvido via tenant do token
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { hashToken } from './tokens'

export interface CancelBookingInput {
  rawToken: string
  ipHash: string
}

export interface CancelBookingOk {
  ok: true
  data: {
    appointmentId: string
    scheduledAt: string
    cancelledAt: string
  }
}

export interface CancelBookingErr {
  ok: false
  error:
    | 'TOKEN_NOT_VALID'
    | 'TOKEN_EXPIRED'
    | 'TOKEN_ALREADY_USED'
    | 'CANCEL_WINDOW_EXPIRED'
    | 'INTERNAL_ERROR'
  message?: string
  clinicPhone?: string | null
  clinicEmail?: string | null
}

export async function cancelByToken(
  supabase: SupabaseClient<Database>,
  input: CancelBookingInput,
): Promise<CancelBookingOk | CancelBookingErr> {
  const tokenHash = hashToken(input.rawToken)

  // 1. Lookup token.
  const { data: tokenRow, error: tokenError } = await supabase
    .from('public_booking_tokens')
    .select('id, tenant_id, appointment_id, expires_at, used_at, action')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (tokenError) {
    return { ok: false, error: 'INTERNAL_ERROR', message: tokenError.message }
  }
  if (!tokenRow) {
    return { ok: false, error: 'TOKEN_NOT_VALID' }
  }
  if (tokenRow.action !== 'cancel') {
    return { ok: false, error: 'TOKEN_NOT_VALID' }
  }
  if (tokenRow.used_at) {
    return { ok: false, error: 'TOKEN_ALREADY_USED' }
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'TOKEN_EXPIRED' }
  }

  // 2. Resolve appointment + tenant policies.
  const [apptRes, clinicRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, tenant_id, appointment_at, frozen_amount_cents')
      .eq('id', tokenRow.appointment_id)
      .eq('tenant_id', tokenRow.tenant_id)
      .maybeSingle(),
    supabase
      .from('tenant_clinic_profile')
      .select('public_booking_cancel_min_hours, phone, email')
      .eq('tenant_id', tokenRow.tenant_id)
      .maybeSingle(),
  ])

  if (apptRes.error || !apptRes.data) {
    return { ok: false, error: 'TOKEN_NOT_VALID' }
  }
  const appt = apptRes.data
  const cancelMinHours = clinicRes.data?.public_booking_cancel_min_hours ?? 6
  const clinicPhone = (clinicRes.data?.phone as string | null) ?? null
  const clinicEmail = (clinicRes.data?.email as string | null) ?? null

  // 3. Valida janela de cancelamento.
  const scheduledMs = new Date(appt.appointment_at).getTime()
  const minNoticeMs = cancelMinHours * 60 * 60 * 1000
  if (scheduledMs - Date.now() < minNoticeMs) {
    return {
      ok: false,
      error: 'CANCEL_WINDOW_EXPIRED',
      message: `Cancelamento online disponível até ${cancelMinHours}h antes da consulta. Entre em contato com a clínica.`,
      clinicPhone,
      clinicEmail,
    }
  }

  // 4. Resolve admin do tenant para satisfazer created_by NOT NULL.
  const { data: adminRow } = await supabase
    .from('user_tenants')
    .select('user_id')
    .eq('tenant_id', tokenRow.tenant_id)
    .eq('role', 'admin')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!adminRow) {
    return {
      ok: false,
      error: 'INTERNAL_ERROR',
      message: 'no active admin to attribute cancellation',
    }
  }
  const createdBy = adminRow.user_id as string

  // 5. INSERT reversal (princípio I: nunca UPDATE em appointments.status).
  //    Trigger release_slot_lock_on_reversal libera appointment_slot_locks
  //    automaticamente.
  const reversalAmountCents = -(appt.frozen_amount_cents as number)
  const { error: revError } = await supabase.from('appointment_reversals').insert({
    tenant_id: tokenRow.tenant_id,
    appointment_id: appt.id,
    reversal_amount_cents: reversalAmountCents,
    reason: `public_booking_cancel: ipHash=${input.ipHash.slice(0, 16)}`,
    created_by: createdBy,
  } as never)
  if (revError) {
    return {
      ok: false,
      error: 'INTERNAL_ERROR',
      message: `reversal insert: ${revError.message}`,
    }
  }

  // 6. UPDATE token.used_at.
  const cancelledAt = new Date().toISOString()
  const { error: tokenUpdError } = await supabase
    .from('public_booking_tokens')
    .update({ used_at: cancelledAt } as never)
    .eq('id', tokenRow.id)
  if (tokenUpdError) {
    logger.warn(
      { err: tokenUpdError, tokenId: tokenRow.id },
      'public-booking-token-mark-used-failed',
    )
  }

  // 7. Audit log adicional com event_type específico.
  try {
    await supabase.rpc(
      'log_audit_event' as never,
      {
        p_tenant_id: tokenRow.tenant_id,
        p_entity: 'appointments',
        p_entity_id: appt.id,
        p_field: 'public_booking_cancelled',
        p_old: 'agendado',
        p_new: 'cancelado',
        p_reason: `ip_hash=${input.ipHash}`,
      } as never,
    )
  } catch {
    // best-effort
  }

  // 8. Bell notifications para admins.
  void notifyAdminsCancellation(supabase, {
    tenantId: tokenRow.tenant_id,
    appointmentId: appt.id,
  })

  return {
    ok: true,
    data: {
      appointmentId: appt.id,
      scheduledAt: appt.appointment_at,
      cancelledAt,
    },
  }
}

async function notifyAdminsCancellation(
  supabase: SupabaseClient<Database>,
  input: { tenantId: string; appointmentId: string },
): Promise<void> {
  try {
    const { data: ut } = await supabase
      .from('user_tenants')
      .select('user_id')
      .eq('tenant_id', input.tenantId)
      .eq('role', 'admin')
      .eq('status', 'active')
    const rows = ((ut ?? []) as Array<{ user_id: string }>).map((r) => ({
      tenant_id: input.tenantId,
      user_id: r.user_id,
      type: 'public_booking' as const,
      title: 'Agendamento cancelado pelo paciente',
      body: `O paciente cancelou o agendamento via link público.`,
      reference_id: input.appointmentId,
      reference_type: 'appointment' as const,
      reference_key: `${input.appointmentId}:cancelled`,
    }))
    if (rows.length === 0) return
    await supabase.from('notifications').upsert(rows as never, {
      onConflict: 'tenant_id,user_id,type,reference_key',
      ignoreDuplicates: true,
    })
  } catch (err) {
    logger.warn(
      { err, tenantId: input.tenantId, appointmentId: input.appointmentId },
      'public-booking-cancel-notification-failed',
    )
  }
}
