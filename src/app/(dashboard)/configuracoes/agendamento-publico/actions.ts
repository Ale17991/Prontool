'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import {
  PublicBookingConfigUpdateSchema,
  PublishedDoctorUpsertSchema,
  PublishedProcedureUpsertSchema,
  removePublishedDoctor,
  removePublishedProcedure,
  updatePublicBookingConfig,
  upsertPublishedDoctor,
  upsertPublishedProcedure,
} from '@/lib/core/public-booking/config'

const PATH = '/configuracoes/agendamento-publico'

async function authorize() {
  const session = await getSession()
  if (!session) throw new Error('UNAUTHENTICATED')
  if (!can(session.role, 'public_booking.config')) throw new Error('FORBIDDEN')
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  return { session, supabase }
}

export interface ActionResult {
  ok: boolean
  error?: string
}

export async function saveConfigAction(input: unknown): Promise<ActionResult> {
  try {
    const { session, supabase } = await authorize()
    const parsed = PublicBookingConfigUpdateSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      }
    }
    await updatePublicBookingConfig(supabase, session.tenantId, parsed.data)
    revalidatePath(PATH)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'SLUG_ALREADY_TAKEN') {
      return { ok: false, error: 'Este endereço já está em uso. Tente outro.' }
    }
    return { ok: false, error: msg }
  }
}

export async function upsertDoctorAction(input: unknown): Promise<ActionResult> {
  try {
    const { session, supabase } = await authorize()
    const parsed = PublishedDoctorUpsertSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      }
    }
    await upsertPublishedDoctor(supabase, session.tenantId, parsed.data)
    revalidatePath(PATH)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function removeDoctorAction(doctorId: string): Promise<ActionResult> {
  try {
    const { session, supabase } = await authorize()
    if (!doctorId || typeof doctorId !== 'string') {
      return { ok: false, error: 'doctorId obrigatório' }
    }
    await removePublishedDoctor(supabase, session.tenantId, doctorId)
    revalidatePath(PATH)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function upsertProcedureAction(input: unknown): Promise<ActionResult> {
  try {
    const { session, supabase } = await authorize()
    const parsed = PublishedProcedureUpsertSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      }
    }
    await upsertPublishedProcedure(supabase, session.tenantId, parsed.data)
    revalidatePath(PATH)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function removeProcedureAction(
  doctorId: string,
  procedureId: string,
): Promise<ActionResult> {
  try {
    const { session, supabase } = await authorize()
    await removePublishedProcedure(supabase, session.tenantId, doctorId, procedureId)
    revalidatePath(PATH)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
