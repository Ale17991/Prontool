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

/** O ciclo do `pg_cron` — o mesmo `CICLO_MINUTOS` do motor. */
const CICLO_MINUTOS = 5

export interface PreviewResult {
  candidatosHoje: number
  tetoPorCiclo: number
  /** Quantas mensagens cabem num dia, dado o espaçamento e a janela de horário. */
  capacidadeDoDia: number
  /** Minutos até a última mensagem da fila sair. */
  minutosDeFila: number
  /** A fila não vaza dentro da janela de horário de um dia. */
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
    .select(
      'timezone, corporate_name, automation_max_per_cycle, automation_window_start, automation_window_end',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const p = perfil as {
    timezone: string | null
    corporate_name: string | null
    automation_max_per_cycle: number
    automation_window_start: string | null
    automation_window_end: string | null
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

  /**
   * O aviso mudou de pergunta quando o teto virou espaçamento.
   *
   * Antes o teto era de volume (50 por ciclo diário), e passar dele significava
   * "vai levar mais de um dia". Agora o teto é 1 por ciclo de 5 minutos, e
   * comparar com ele acusaria fila demais para DOIS aniversariantes — que levam
   * cinco minutos e cabem folgados. O que importa é se a fila vaza dentro da
   * janela de horário da clínica: fora dela o motor para, e o que sobrar espera
   * o dia seguinte. Para as fontes com chave do dia (aniversário), esperar o dia
   * seguinte é perder a data — daí o aviso ser sobre isso, e não sobre demora.
   */
  const teto = p?.automation_max_per_cycle ?? 1
  const inicio = minutosDoRelogio(p?.automation_window_start ?? '08:00')
  const fim = minutosDoRelogio(p?.automation_window_end ?? '20:00')
  const janelaMinutos = Math.max(0, fim - inicio)
  const capacidadeDoDia = Math.floor(janelaMinutos / CICLO_MINUTOS) * teto

  return {
    candidatosHoje: candidatos.length,
    tetoPorCiclo: teto,
    capacidadeDoDia,
    minutosDeFila: Math.max(0, Math.ceil((candidatos.length - 1) / teto) * CICLO_MINUTOS),
    avisoVolume: candidatos.length > capacidadeDoDia,
  }
}

/** `08:00` ou `08:00:00` em minutos desde a meia-noite. */
function minutosDoRelogio(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
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
