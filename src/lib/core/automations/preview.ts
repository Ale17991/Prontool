/**
 * Feature 056 — quantos pacientes este gatilho atinge hoje (FR-014).
 *
 * Usa A MESMA `enumerate` do motor. Se a prévia tivesse consulta própria, ela
 * divergiria no primeiro ajuste de regra — e prévia que mente é pior que
 * nenhuma, porque é sobre ela que a clínica decide ativar.
 *
 * A prévia responde por FONTE E PARÂMETROS, não por gatilho gravado: a clínica
 * pergunta "quantos isso pega?" ANTES de criar a automação, enquanto ainda está
 * escolhendo o intervalo. Perguntar só depois de gravar inverteria a ordem do
 * cuidado — o aviso de volume chegaria quando a decisão já foi tomada.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSource } from './sources'
import { janelaDoDia } from './sources/shared'

export interface PreviewResult {
  candidatosHoje: number
  tetoPorCiclo: number
  /** Ativar vai levar mais de um ciclo para vazar a fila. */
  avisoVolume: boolean
}

export async function previewSource(
  supabase: SupabaseClient,
  tenantId: string,
  source: string,
  params: Record<string, unknown>,
  now: Date = new Date(),
): Promise<PreviewResult> {
  const fonte = getSource(source)
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

  /**
   * A janela da prévia é o DIA INTEIRO da clínica, não os 15 minutos do ciclo.
   *
   * Para uma fonte ancorada num horário ("2 horas antes da consulta"), a janela
   * real de um ciclo pega os pacientes de 15 minutos — e a prévia responderia
   * "1 paciente" para uma automação que vai mandar cem mensagens ao longo do
   * dia. A pergunta da clínica é sobre o dia, e é o dia que a prévia mede.
   */
  const dia = janelaDoDia(today, tz)

  const candidatos = await fonte.enumerate({
    supabase,
    tenantId,
    today,
    now: new Date(dia.ate),
    windowFrom: new Date(dia.de),
    previewMode: true,
    timezone: tz,
    clinicName: p?.corporate_name ?? 'Clínica',
    params: params ?? {},
  })

  const teto = p?.automation_max_per_cycle ?? 50
  return {
    candidatosHoje: candidatos.length,
    tetoPorCiclo: teto,
    avisoVolume: candidatos.length > teto,
  }
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
  return previewSource(supabase, tenantId, t.source, t.params ?? {}, now)
}
