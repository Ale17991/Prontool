/**
 * Feature 056 — o motor: varre as automações ativas e resolve cada candidato.
 *
 * Roda dentro do ciclo diário que já existe, DEPOIS do motor de lembretes e em
 * bloco protegido próprio (research D1). Os dois não podem se derrubar: falha
 * aqui não pode impedir lembrete de consulta de sair, e vice-versa.
 *
 * O motor não conhece nenhuma fonte nominalmente — pergunta ao registro. É essa
 * ignorância que faz a absorção futura do lembrete (FR-025) ser "mais um
 * arquivo em sources/" em vez de reescrita.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { dispatchAlert } from '@/lib/core/alerts/dispatcher'
import { getDecryptedApiKey, isWhatsAppConnected } from '@/lib/core/whatsapp/config'
import { sendText } from '@/lib/core/whatsapp/service-client'
import { isSendablePhone, normalizePhone } from '@/lib/core/whatsapp/phone'
import { getSource } from './sources'
import { janelaDoDia } from './sources/shared'
import { listActiveAutomations } from './store'
import {
  claimOccurrence,
  countSentToday,
  releaseSuppressed,
  settleOccurrence,
} from './occurrences'
import { render } from './render'
import type { EvaluateResult } from './types'

const DEFAULT_TZ = 'America/Sao_Paulo'
/** Mesmo espaçamento do motor de lembretes — o número é o mesmo. */
const SPACING_MS = 1000

/** Dia civil da clínica, nunca a data do servidor. */
function clinicToday(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Meia-noite da clínica, em UTC — o marco do teto por paciente/dia.
 *
 * Usa o mesmo cálculo de fuso das fontes (`janelaDoDia`) em vez de uma tabela
 * de offset embutida: uma clínica em Manaus ou Fernando de Noronha teria o dia
 * começando na hora errada, e o teto diário passaria a cortar no meio da tarde.
 */
function startOfClinicDayIso(today: string, timezone: string): string {
  return janelaDoDia(today, timezone).de
}

export async function evaluateAutomations(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<EvaluateResult> {
  const total: EvaluateResult = {
    avaliadas: 0,
    enviadas: 0,
    suprimidas: 0,
    impedidas: 0,
    falhas: 0,
  }

  const { data: tenants, error } = await supabase
    .from('tenant_clinic_profile')
    .select(
      'tenant_id, timezone, corporate_name, automation_max_per_patient_day, automation_max_per_cycle',
    )
  if (error) {
    logger.error({}, 'automations-load-tenants-failed')
    return total
  }

  for (const t of (tenants ?? []) as Array<{
    tenant_id: string
    timezone: string | null
    corporate_name: string | null
    automation_max_per_patient_day: number
    automation_max_per_cycle: number
  }>) {
    try {
      const parcial = await evaluateTenant(supabase, t, now)
      total.avaliadas += parcial.avaliadas
      total.enviadas += parcial.enviadas
      total.suprimidas += parcial.suprimidas
      total.impedidas += parcial.impedidas
      total.falhas += parcial.falhas
    } catch (err) {
      // Uma clínica quebrada não pode calar as outras.
      total.falhas++
      logger.error(
        { tenantId: t.tenant_id, err: err instanceof Error ? err.message : 'unknown' },
        'automations-tenant-failed',
      )
    }
  }

  return total
}

async function evaluateTenant(
  supabase: SupabaseClient,
  tenant: {
    tenant_id: string
    timezone: string | null
    corporate_name: string | null
    automation_max_per_patient_day: number
    automation_max_per_cycle: number
  },
  now: Date,
): Promise<EvaluateResult> {
  const r: EvaluateResult = { avaliadas: 0, enviadas: 0, suprimidas: 0, impedidas: 0, falhas: 0 }
  const tenantId = tenant.tenant_id

  // GATE DE MÓDULO NO MOTOR, não só na tela (FR-023). `automations.active` é
  // estado persistido: uma clínica que ligou automações e depois teve o módulo
  // revogado continuaria enviando para sempre se o gate morasse só na UI.
  // Módulo desligado NÃO gera alerta — não é falha operacional, é ausência de
  // contratação.
  const ent = await getTenantEntitlements(supabase as never, tenantId).catch(() => null)
  if (ent && !ent.hasModule('automacoes')) return r

  const automacoes = await listActiveAutomations(supabase, tenantId)
  if (automacoes.length === 0) return r

  /**
   * Sem canal conectado: UMA ocorrência agregada por ciclo (FR-021), nunca uma
   * por paciente.
   *
   * O registro é um ALERTA, e não uma linha em `automation_occurrences`, por
   * dois motivos que se somam. O primeiro é de schema: a ocorrência exige
   * `patient_id` NOT NULL, e o fato aqui não é sobre paciente nenhum — é sobre a
   * clínica. O segundo é de propósito: gravar uma ocorrência consumiria a chave
   * `(automação, paciente, chave)` de gente que ainda vai receber a mensagem
   * quando o número voltar, e a supressão só é reversível para os dois desfechos
   * de teto. O alerta aparece para a clínica, deduplica por hora e não custa
   * nada do que ainda pode ser entregue.
   *
   * Mesmo tratamento da 051, deliberadamente.
   */
  const conectado = await isWhatsAppConnected(supabase as never, tenantId).catch(() => false)
  if (!conectado) {
    logger.warn({ tenantId }, 'automations-whatsapp-not-connected')
    await dispatchAlert({
      tenantId,
      type: 'integration_sync_failed',
      subjectRef: { provider: 'whatsapp', reason: 'not_connected_automations' },
      detail: {
        provider: 'whatsapp',
        mensagem:
          'O WhatsApp da clínica não está conectado. As automações de mensagem não foram avaliadas neste ciclo.',
      },
    }).catch(() => {
      // Best-effort: alerta não pode derrubar o ciclo das outras clínicas.
    })
    return r
  }

  const apiKey = await getDecryptedApiKey(supabase as never, tenantId).catch(() => null)
  if (!apiKey) return r

  const tz = tenant.timezone ?? DEFAULT_TZ
  const today = clinicToday(now, tz)
  const inicioDoDia = startOfClinicDayIso(today, tz)
  const clinicName = tenant.corporate_name ?? 'Clínica'

  let enviadasNoCiclo = 0

  // Um cache por CLÍNICA e por CICLO. Vive só o tempo desta função de propósito:
  // cache que atravessasse ciclos guardaria consentimento já revogado.
  const cache = new Map<string, unknown>()

  for (const auto of automacoes) {
    const fonte = getSource(auto.source)
    if (!fonte) {
      logger.warn({ tenantId, source: auto.source }, 'automations-unknown-source')
      continue
    }

    let candidatos
    try {
      candidatos = await fonte.enumerate({
        supabase,
        tenantId,
        today,
        timezone: tz,
        clinicName,
        params: auto.params,
        cache,
      })
    } catch (err) {
      r.falhas++
      logger.error(
        { tenantId, source: auto.source, err: err instanceof Error ? err.message : 'unknown' },
        'automations-enumerate-failed',
      )
      continue
    }

    // Ordenação determinística: o corte do teto precisa ser reprodutível entre
    // execuções, senão quem fica de fora é sorteado a cada ciclo.
    candidatos.sort((a, b) => a.patientId.localeCompare(b.patientId))

    for (const cand of candidatos) {
      r.avaliadas++

      // Reserva ANTES de qualquer trabalho. Se a linha já existe, este ciclo é
      // reexecução e não há nada a fazer.
      const occId = await claimOccurrence(supabase, {
        tenantId,
        automationId: auto.id,
        patientId: cand.patientId,
        occurrenceKey: cand.occurrenceKey,
      })
      if (!occId) continue

      // Teto por clínica: o excedente fica para os ciclos seguintes.
      if (enviadasNoCiclo >= tenant.automation_max_per_cycle) {
        await settleOccurrence(supabase, occId, 'suprimido_teto_clinica')
        await releaseSuppressed(supabase, occId)
        r.suprimidas++
        continue
      }

      // Teto por paciente/dia.
      const jaHoje = await countSentToday(supabase, tenantId, cand.patientId, inicioDoDia, occId)
      if (jaHoje >= tenant.automation_max_per_patient_day) {
        await settleOccurrence(supabase, occId, 'suprimido_teto_paciente')
        await releaseSuppressed(supabase, occId)
        r.suprimidas++
        continue
      }

      const desfecho = await enviarUm({
        supabase,
        tenantId,
        apiKey,
        body: auto.body,
        variables: cand.variables,
        patientId: cand.patientId,
        occurrenceId: occId,
      })

      if (desfecho === 'enviado') {
        r.enviadas++
        enviadasNoCiclo++
        await new Promise((res) => setTimeout(res, SPACING_MS))
      } else if (desfecho === 'falhou') {
        r.falhas++
      } else {
        r.impedidas++
      }
    }
  }

  return r
}

async function enviarUm(args: {
  supabase: SupabaseClient
  tenantId: string
  apiKey: string
  body: string
  variables: Record<string, string>
  patientId: string
  occurrenceId: string
}): Promise<'enviado' | 'falhou' | 'impedido'> {
  const { supabase, tenantId, patientId, occurrenceId } = args

  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    await settleOccurrence(supabase, occurrenceId, 'falhou', {
      reason: 'PATIENT_DATA_ENCRYPTION_KEY ausente',
    })
    return 'falhou'
  }

  // Consentimento HIERÁRQUICO: o mestre cala todos os canais; o de automações
  // só é consultado quando o mestre está ligado. São manifestações distintas.
  const { data: pac } = await supabase
    .from('patients')
    .select('reminders_opt_in, automations_opt_in, status, anonymized_at')
    .eq('tenant_id', tenantId)
    .eq('id', patientId)
    .maybeSingle()

  const p = pac as {
    reminders_opt_in: boolean | null
    automations_opt_in: boolean | null
    status: string | null
    anonymized_at: string | null
  } | null

  if (!p || p.anonymized_at || (p.status && p.status !== 'ativo')) {
    await settleOccurrence(supabase, occurrenceId, 'impedido_sem_consentimento', {
      reason: 'paciente inativo ou anonimizado',
    })
    return 'impedido'
  }
  if (p.reminders_opt_in === false || p.automations_opt_in !== true) {
    await settleOccurrence(supabase, occurrenceId, 'impedido_sem_consentimento')
    return 'impedido'
  }

  const dec = await supabase.rpc('get_patient_for_tenant', {
    p_tenant_id: tenantId,
    p_patient_id: patientId,
    p_key: key,
  })
  if (dec.error || !dec.data) {
    await settleOccurrence(supabase, occurrenceId, 'falhou', { reason: 'decrypt-patient-failed' })
    return 'falhou'
  }
  const paciente = (Array.isArray(dec.data) ? dec.data[0] : dec.data) as {
    full_name: string | null
    phone: string | null
  } | null

  if (!paciente?.phone || !isSendablePhone(paciente.phone)) {
    await settleOccurrence(supabase, occurrenceId, 'impedido_sem_telefone')
    return 'impedido'
  }

  // Variável sem dado PULA o envio (FR-006). Mandar "Feliz aniversário, !" é
  // pior que não mandar.
  const { text, missing } = render(args.body, {
    ...args.variables,
    paciente: args.variables.paciente ?? paciente.full_name ?? '',
  })
  if (!text) {
    await settleOccurrence(supabase, occurrenceId, 'impedido_variavel_ausente', {
      reason: `sem valor para: ${missing.join(', ')}`,
    })
    return 'impedido'
  }

  const res = await sendText({
    apiKey: args.apiKey,
    to: normalizePhone(paciente.phone),
    message: text,
    // O id da ocorrência é a chave de idempotência ponta a ponta: o serviço
    // deduplica por (tenant, externalId), então retentativa não duplica.
    externalId: occurrenceId,
  })

  if (res.ok) {
    await settleOccurrence(supabase, occurrenceId, 'enviado', {
      providerMessageId: res.providerMessageId,
    })
    return 'enviado'
  }

  if (res.kind === 'no_connection') {
    await settleOccurrence(supabase, occurrenceId, 'impedido_sem_conexao')
    return 'impedido'
  }

  await settleOccurrence(supabase, occurrenceId, 'falhou', { reason: `${res.kind}: ${res.detail}` })
  return 'falhou'
}
