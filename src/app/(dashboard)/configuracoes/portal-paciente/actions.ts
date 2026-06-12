'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import type { Database } from '@/lib/db/types'
import {
  PatientPortalConfigUpdateSchema,
  setMetricEnabled,
  updatePatientPortalConfig,
  type MetricSetting,
} from '@/lib/core/patient-portal/portal-config'
import { createCustomMetricType } from '@/lib/core/patient-portal/metric-types'
import { setPortalSection } from '@/lib/core/patient-portal/sections'

const PATH = '/configuracoes/portal-paciente'

async function authorize() {
  const session = await getSession()
  if (!session) throw new Error('UNAUTHENTICATED')
  if (!can(session.role, 'patient_portal.config')) throw new Error('FORBIDDEN')
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  return { session, supabase }
}

export interface ActionResult {
  ok: boolean
  error?: string
}

export async function savePortalConfigAction(input: unknown): Promise<ActionResult> {
  try {
    const { session, supabase } = await authorize()
    const parsed = PatientPortalConfigUpdateSchema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      }
    }
    await updatePatientPortalConfig(supabase, session.tenantId, parsed.data)
    revalidatePath(PATH)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'SLUG_ALREADY_TAKEN') {
      return { ok: false, error: 'Este endereço já está em uso por outra clínica. Tente outro.' }
    }
    return { ok: false, error: msg }
  }
}

export async function setMetricEnabledAction(
  metricType: string,
  enabled: boolean,
): Promise<ActionResult> {
  try {
    const { session, supabase } = await authorize()
    if (!metricType || typeof metricType !== 'string') {
      return { ok: false, error: 'metricType obrigatório' }
    }
    await setMetricEnabled(supabase, session.tenantId, metricType, enabled)
    revalidatePath(PATH)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface CreateMetricResult extends ActionResult {
  metric?: MetricSetting
}

/** Cadastra uma métrica personalizada da clínica (custom). Só admin. */
export async function createMetricAction(input: {
  label: string
  unit: string
  minPlausible: number
  maxPlausible: number
}): Promise<CreateMetricResult> {
  try {
    const { session, supabase } = await authorize()
    const created = await createCustomMetricType(supabase, {
      tenantId: session.tenantId,
      label: input.label,
      unit: input.unit,
      minPlausible: input.minPlausible,
      maxPlausible: input.maxPlausible,
      specialty: 'endocrino',
    })
    revalidatePath(PATH)
    return { ok: true, metric: { ...created, enabled: true } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function setPortalSectionAction(
  sectionKey: string,
  enabled: boolean,
): Promise<ActionResult> {
  try {
    const { session, supabase } = await authorize()
    if (!sectionKey || typeof sectionKey !== 'string') {
      return { ok: false, error: 'sectionKey obrigatório' }
    }
    await setPortalSection(supabase, session.tenantId, sectionKey, enabled)
    revalidatePath(PATH)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
