/**
 * Feature 056 — quantos pacientes este gatilho atinge hoje (FR-014).
 *
 * Usa A MESMA `enumerate` do motor. Se a prévia tivesse consulta própria, ela
 * divergiria no primeiro ajuste de regra — e prévia que mente é pior que
 * nenhuma, porque é sobre ela que a clínica decide ativar.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSource } from './sources'

export interface PreviewResult {
  candidatosHoje: number
  tetoPorCiclo: number
  /** Ativar vai levar mais de um ciclo para vazar a fila. */
  avisoVolume: boolean
}

export async function previewTrigger(
  supabase: SupabaseClient,
  tenantId: string,
  triggerId: string,
  now: Date = new Date(),
): Promise<PreviewResult> {
  const { data: trigger, error } = await supabase
    .from('automation_triggers')
    .select('source, params')
    .eq('tenant_id', tenantId)
    .eq('id', triggerId)
    .maybeSingle()
  if (error || !trigger) throw new Error('GATILHO_NAO_ENCONTRADO')

  const t = trigger as { source: string; params: Record<string, unknown> }
  const fonte = getSource(t.source)
  if (!fonte) throw new Error('FONTE_DESCONHECIDA')

  const { data: perfil } = await supabase
    .from('tenant_clinic_profile')
    .select('timezone, corporate_name, automation_max_per_cycle')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const p = perfil as {
    timezone: string | null
    corporate_name: string | null
    automation_max_per_cycle: number
  } | null

  const tz = p?.timezone ?? 'America/Sao_Paulo'
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)

  const candidatos = await fonte.enumerate({
    supabase,
    tenantId,
    today,
    timezone: tz,
    clinicName: p?.corporate_name ?? 'Clínica',
    params: t.params ?? {},
  })

  const teto = p?.automation_max_per_cycle ?? 50
  return {
    candidatosHoje: candidatos.length,
    tetoPorCiclo: teto,
    avisoVolume: candidatos.length > teto,
  }
}
