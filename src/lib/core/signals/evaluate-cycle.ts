/**
 * Feature 053 — o ciclo diário.
 *
 * Pipeline por clínica:
 *   1. módulo `acompanhamento` ligado?           (gate NO MOTOR, não só na tela)
 *   2. dentro da janela horária da clínica?
 *   3. para cada regra ativa, na ordem de prioridade:
 *        público → família.evaluate() → portões → ocorrência → enfileira
 *
 * A ordem de prioridade é o que faz a celebração vencer a cobrança quando o
 * teto do paciente binda: as famílias de celebração ocupam a faixa 1–9 e as de
 * ausência 10+, então avaliar em ordem crescente já entrega a precedência sem
 * nenhuma lógica dedicada.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { isWithinWindow } from '@/lib/core/reminders/select-due'
import { familyById } from './catalog'
import { resolveAudience } from './audience'
import { decideGate, portalActivity } from './gates'
import { patientsInSilence, recordOccurrence, sentCountLast7Days } from './occurrences'
import { renderTemplate } from './template'
import type { SignalOutcome, SignalRule } from './types'

const DEFAULT_TZ = 'America/Sao_Paulo'
const MAX_TENANTS_PARALLEL = 3

export interface CycleResult {
  tenants: number
  avaliadas: number
  porDesfecho: Record<SignalOutcome, number>
  durationMs: number
}

/** O que o ciclo decidiu enviar. A entrega em si acontece fora, no worker. */
export interface PendingMessage {
  tenantId: string
  occurrenceId: string
  ruleId: string
  patientId: string
  channel: string
  body: string
}

export async function evaluateCycle(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<{ result: CycleResult; pending: PendingMessage[] }> {
  const t0 = Date.now()
  const porDesfecho = zeros()
  const pending: PendingMessage[] = []
  let avaliadas = 0
  let tenantsTocados = 0

  const tenantIds = await tenantsComRegraAtiva(supabase)

  for (let i = 0; i < tenantIds.length; i += MAX_TENANTS_PARALLEL) {
    const chunk = tenantIds.slice(i, i + MAX_TENANTS_PARALLEL)
    const parciais = await Promise.all(
      chunk.map((tenantId) => processarClinica(supabase, tenantId, now)),
    )
    for (const p of parciais) {
      if (!p) continue
      tenantsTocados += 1
      avaliadas += p.avaliadas
      pending.push(...p.pending)
      for (const [k, v] of Object.entries(p.porDesfecho)) {
        porDesfecho[k as SignalOutcome] += v
      }
    }
  }

  return {
    result: { tenants: tenantsTocados, avaliadas, porDesfecho, durationMs: Date.now() - t0 },
    pending,
  }
}

async function processarClinica(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  now: Date,
): Promise<{ avaliadas: number; porDesfecho: Record<SignalOutcome, number>; pending: PendingMessage[] } | null> {
  // GATE DO MÓDULO, NO MOTOR. Lição da 051: a regra ligada é estado
  // persistido, e um gate só de UI impede de LIGAR, não de continuar ligado —
  // clínica com o módulo revogado no /admin seguiria enviando para sempre, o
  // que é cobrança indevida.
  const ent = await getTenantEntitlements(supabase, tenantId).catch(() => null)
  if (ent && !ent.hasModule('acompanhamento')) return null

  const perfil = await supabase
    .from('tenant_clinic_profile')
    .select(
      'timezone, corporate_name, reminder_window_start, reminder_window_end, outreach_weekly_cap',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const p = (perfil.data ?? null) as {
    timezone: string | null
    corporate_name: string | null
    reminder_window_start: string | null
    reminder_window_end: string | null
    outreach_weekly_cap: number | null
  } | null

  const tz = p?.timezone ?? DEFAULT_TZ
  const janelaInicio = trimSeconds(p?.reminder_window_start) ?? '08:00'
  const janelaFim = trimSeconds(p?.reminder_window_end) ?? '20:00'
  if (!isWithinWindow(now, janelaInicio, janelaFim, tz)) return null

  const cap = p?.outreach_weekly_cap ?? 2
  const clinica = p?.corporate_name ?? 'sua clínica'
  const cycleDate = diaNaClinica(now, tz)

  const regras = await regrasAtivas(supabase, tenantId)
  if (regras.length === 0) return null

  const porDesfecho = zeros()
  const pending: PendingMessage[] = []
  let avaliadas = 0

  // Quantas mensagens cada paciente já recebeu na semana — uma consulta para a
  // clínica inteira, não uma por regra.
  const todosPacientes = await resolveAudience(supabase, {
    tenantId,
    audience: 'todos_ativos',
    audienceDoctorId: null,
  })
  const enviadasNaSemana = await sentCountLast7Days(supabase, tenantId, todosPacientes, now)
  // Decisões tomadas NESTE ciclo contam para o teto junto com as da semana —
  // senão três regras aplicáveis ao mesmo paciente furariam o teto todas de uma
  // vez, cada uma achando que ainda havia vaga.
  const decididasNesteCiclo = new Map<string, number>()

  const nomes = await nomesDosPacientes(supabase, tenantId, todosPacientes)

  for (const regra of regras) {
    const familia = familyById(regra.family)
    if (!familia || !familia.implemented) continue

    const parsed = familia.paramsSchema.safeParse(regra.params)
    if (!parsed.success) {
      // Params gravados antes de uma mudança de schema. Pular é melhor que
      // estourar o ciclo inteiro por causa de uma regra.
      logger.warn({ tenantId, ruleId: regra.id }, 'signal-rule-params-invalid')
      continue
    }

    const publico =
      regra.audience === 'todos_ativos'
        ? todosPacientes
        : await resolveAudience(supabase, {
            tenantId,
            audience: regra.audience,
            audienceDoctorId: regra.audienceDoctorId,
          })

    const candidatos = await familia
      .evaluate({
        supabase,
        tenantId,
        params: parsed.data as Record<string, unknown>,
        patientIds: publico,
        cycleDate,
        timezone: tz,
      })
      .catch((err) => {
        logger.error({ tenantId, ruleId: regra.id, err: String(err) }, 'signal-evaluate-failed')
        return []
      })

    if (candidatos.length === 0) continue
    avaliadas += candidatos.length

    const emSilencio = await patientsInSilence(supabase, tenantId, regra.id, regra.silenceDays, now)

    // O filtro de portal só é carregado para famílias que dele precisam — a
    // consulta é cara e a maioria das famílias não a usa.
    const portal = familia.requiresPortalActivity
      ? await portalActivity(
          supabase,
          tenantId,
          candidatos.map((c) => c.patientId),
          janelaDaFamilia(parsed.data as Record<string, unknown>),
          now,
        )
      : null

    for (const cand of candidatos) {
      const desfecho: SignalOutcome | null = decideGate(cand.patientId, {
        emSilencio,
        enviadasNaSemana,
        cap,
        portal,
        decididasNesteCiclo,
      })

      if (desfecho) {
        const id = await recordOccurrence(supabase, {
          tenantId,
          ruleId: regra.id,
          patientId: cand.patientId,
          cycleDate,
          outcome: desfecho,
          observed: cand.observed,
        })
        if (id) porDesfecho[desfecho] += 1
        continue
      }

      const body = renderTemplate(regra.messageTemplate, {
        ...cand.values,
        paciente: primeiroNome(nomes.get(cand.patientId) ?? ''),
        clinica,
      })

      const occurrenceId = await recordOccurrence(supabase, {
        tenantId,
        ruleId: regra.id,
        patientId: cand.patientId,
        cycleDate,
        outcome: 'enviada',
        observed: cand.observed,
      })
      // Conflito de unique = este dia já foi processado. Reprocessar não pode
      // gerar segunda mensagem (FR-024).
      if (!occurrenceId) continue

      porDesfecho.enviada += 1
      decididasNesteCiclo.set(
        cand.patientId,
        (decididasNesteCiclo.get(cand.patientId) ?? 0) + 1,
      )
      pending.push({
        tenantId,
        occurrenceId,
        ruleId: regra.id,
        patientId: cand.patientId,
        channel: regra.channel,
        body,
      })
    }
  }

  return { avaliadas, porDesfecho, pending }
}

/**
 * Janela que a família observa, para o filtro de portal. Usa o próprio
 * parâmetro de dias da regra: perguntar "esteve no portal nos mesmos N dias em
 * que não registrou?" é a pergunta que torna a ausência informativa.
 */
function janelaDaFamilia(params: Record<string, unknown>): number {
  const d = params.days
  return typeof d === 'number' && d > 0 ? d : 14
}

async function tenantsComRegraAtiva(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase
    .from('signal_rules')
    .select('tenant_id')
    .eq('active', true)
  if (error) {
    logger.error({ err: error.message }, 'signal-cycle-load-tenants-failed')
    return []
  }
  return [...new Set((data ?? []).map((r) => (r as { tenant_id: string }).tenant_id))]
}

async function regrasAtivas(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<SignalRule[]> {
  const { data, error } = await supabase
    .from('signal_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('active', true)
  if (error) throw new Error(`regrasAtivas: ${error.message}`)

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  return rows
    .map((r) => ({
      id: r.id as string,
      tenantId: r.tenant_id as string,
      family: r.family as SignalRule['family'],
      params: (r.params ?? {}) as Record<string, unknown>,
      audience: r.audience as SignalRule['audience'],
      audienceDoctorId: (r.audience_doctor_id ?? null) as string | null,
      channel: r.channel as SignalRule['channel'],
      messageTemplate: r.message_template as string,
      silenceDays: r.silence_days as number,
      active: r.active as boolean,
      createdAt: r.created_at as string,
    }))
    .sort(ordemDeterministica)
}

/**
 * Prioridade da família → `created_at` da regra → id. Nunca a ordem em que o
 * banco devolveu: com o teto binding, a ordem DECIDE quem fala, e uma escolha
 * que muda entre execuções faria a mesma clínica ver resultados diferentes
 * para o mesmo dia.
 */
function ordemDeterministica(a: SignalRule, b: SignalRule): number {
  const pa = familyById(a.family)?.priority ?? 999
  const pb = familyById(b.family)?.priority ?? 999
  if (pa !== pb) return pa - pb
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : 1
}

async function nomesDosPacientes(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key || patientIds.length === 0) return out

  // Uma RPC por paciente é N+1, mas só roda para quem vai receber mensagem —
  // e o nome é PII cifrada, que não tem projeção em lote segura hoje.
  for (const id of patientIds) {
    const dec = await supabase.rpc('get_patient_for_tenant', {
      p_tenant_id: tenantId,
      p_patient_id: id,
      p_key: key,
    })
    if (dec.error || !dec.data) continue
    const row = (Array.isArray(dec.data) ? dec.data[0] : dec.data) as {
      full_name: string | null
    } | null
    if (row?.full_name) out.set(id, row.full_name)
  }
  return out
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? ''
}

function diaNaClinica(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function trimSeconds(t: string | null | undefined): string | null {
  if (!t) return null
  return t.length >= 5 ? t.slice(0, 5) : t
}

function zeros(): Record<SignalOutcome, number> {
  return {
    enviada: 0,
    silenciada: 0,
    adiada: 0,
    suprimida_sem_portal: 0,
    sem_consentimento: 0,
    sem_contato: 0,
    falha_envio: 0,
  }
}
