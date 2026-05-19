'use server'

/**
 * Feature 018 — Server actions de configuração do motor de lembretes.
 *
 * RBAC: requireRole(['admin', 'recepcionista']) via action `reminders.config`.
 * Validação Zod do payload. Falhas mapeadas para erros estruturados.
 */

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import {
  ReminderConfigUpdateSchema,
  updateReminderConfig,
  type ReminderConfigUpdate,
} from '@/lib/core/reminders/config'

interface ActionOk {
  ok: true
}

interface ActionErr {
  ok: false
  error: 'UNAUTHORIZED' | 'INVALID_PAYLOAD' | 'INTERNAL_ERROR'
  details?: Array<{ field: string; message: string }>
  message?: string
}

async function authorize(): Promise<
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; response: ActionErr }
> {
  const session = await getSession()
  if (!session) {
    return { ok: false, response: { ok: false, error: 'UNAUTHORIZED' } }
  }
  if (!can(session.role, 'reminders.config')) {
    return { ok: false, response: { ok: false, error: 'UNAUTHORIZED' } }
  }
  return { ok: true, tenantId: session.tenantId, userId: session.userId }
}

/**
 * US1 — salva configuração de lembretes (8 colunas em tenant_clinic_profile).
 * Trigger de audit existente registra automaticamente.
 */
export async function saveReminderConfig(
  input: ReminderConfigUpdate,
): Promise<ActionOk | ActionErr> {
  const auth = await authorize()
  if (!auth.ok) return auth.response

  const parsed = ReminderConfigUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'INVALID_PAYLOAD',
      details: parsed.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    }
  }

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

  try {
    await updateReminderConfig(supabase, auth.tenantId, parsed.data)
    revalidatePath('/configuracoes/lembretes')
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: 'INTERNAL_ERROR',
      message: err instanceof Error ? err.message : 'unknown',
    }
  }
}

/**
 * US4 placeholder — implementação completa em Phase 5 (T043).
 * Mantido aqui para evitar import-quebrado se o toggle de paciente chamar antes.
 */
export async function setPatientReminderOptIn(
  _patientId: string,
  _optIn: boolean,
): Promise<ActionOk | ActionErr> {
  return {
    ok: false,
    error: 'INTERNAL_ERROR',
    message: 'Implementação completa em Phase 5 (US4)',
  }
}
