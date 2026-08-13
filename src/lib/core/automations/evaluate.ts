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
import { listActiveAutomations, markAutomationRan } from './store'
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

/**
 * O intervalo entre dois ciclos, em minutos — o mesmo do `pg_cron` que chama a
 * rota (`deploy-cron-5min.sql`).
 *
 * Cinco minutos, e não quinze, porque o ciclo é também o ESPAÇAMENTO dos envios:
 * o teto por ciclo é de uma mensagem, então a cadência do cron é a distância
 * entre duas mensagens da mesma clínica. Também cabe folgado dentro dos 15
 * minutos que o motor de lembretes (018) espera na sua janela de seleção.
 *
 * Só é usado como CHUTE para a primeira varredura de uma automação ancorada,
 * quando ainda não há `last_ran_at`. Nas seguintes, a janela é o intervalo real
 * entre varreduras — o que mantém a feature correta mesmo que a periodicidade do
 * cron mude sem ninguém atualizar esta constante.
 */
const CICLO_MINUTOS = 5

/**
 * Teto da janela de uma automação ancorada, em minutos.
 *
 * Sem ele, um ciclo que ficou dias parado voltaria perguntando "que âncoras
 * venceram nos últimos três dias" e despejaria de uma vez mensagens cujo momento
 * já passou — "sua consulta é daqui a 2 horas" sobre uma consulta de anteontem.
 * Seis horas é o bastante para atravessar um deploy ruim e curto o bastante para
 * a mensagem ainda fazer sentido; o que passar disso é perdido de propósito.
 */
const JANELA_MAX_MINUTOS = 6 * 60

interface TenantRow {
  tenant_id: string
  timezone: string | null
  corporate_name: string | null
  automation_max_per_patient_day: number
  automation_max_per_cycle: number
  /** Janela própria (0201) — ver o bloco da janela de silêncio no motor. */
  automation_window_start: string | null
  automation_window_end: string | null
  /** Dias PERMITIDOS, convenção do JS: 0 = domingo … 6 = sábado. */
  automation_weekdays: number[] | null
}

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
 * O dia da semana no fuso da clínica, na convenção do JS (0 = domingo).
 *
 * `Date.getDay()` responderia pelo fuso do SERVIDOR, que na Vercel é UTC: às
 * 21h de sábado em São Paulo já é domingo em UTC, e uma clínica que bloqueou
 * domingo veria o bloqueio começar três horas antes da hora.
 */
function clinicWeekday(now: Date, timezone: string): number {
  const nome = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    now,
  )
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nome)
}

/** `HH:MM` no relógio da clínica. */
function clinicClock(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
}

interface Agendamento {
  rodar: boolean
  windowFrom: Date
  /** Dia a gravar em `last_fired_on` — `null` nas ancoradas, que rodam sempre. */
  firedOn: string | null
}

/**
 * Esta automação roda NESTE ciclo?
 *
 * Duas naturezas, e a fonte é quem diz qual é a sua (`isAnchored`):
 *
 * **Ancorada** ("2 horas antes da consulta") roda em todo ciclo, porque a hora
 * de avisar cada paciente é diferente e depende do horário dele. A janela é o
 * intervalo desde a última varredura.
 *
 * **Diária** ("3 dias depois do atendimento") roda UMA vez por dia, no horário
 * que a clínica escolheu. Sem este corte, o ciclo de 5 em 5 minutos faria a
 * mesma varredura 288 vezes por dia — o banco recusaria as ocorrências repetidas
 * pelo UNIQUE, então ninguém receberia mensagem duplicada, mas a clínica pagaria
 * 288 vezes a consulta mais cara da feature para descobrir isso.
 */
export function agendar(
  auto: { params: Record<string, unknown>; sendAtLocal: string; lastFiredOn: string | null; lastRanAt: string | null },
  ancorada: boolean,
  now: Date,
  timezone: string,
  today: string,
): Agendamento {
  const parado = { rodar: false, windowFrom: now, firedOn: null }

  if (ancorada) {
    const anterior = auto.lastRanAt ? Date.parse(auto.lastRanAt) : NaN
    const piso = now.getTime() - JANELA_MAX_MINUTOS * 60_000
    const inicio = Number.isFinite(anterior)
      ? Math.max(anterior, piso)
      : now.getTime() - CICLO_MINUTOS * 60_000
    // Janela vazia ou invertida: aconteceu de o mesmo ciclo rodar duas vezes, ou
    // o relógio andar para trás. Não há o que varrer.
    if (inicio >= now.getTime()) return parado
    return { rodar: true, windowFrom: new Date(inicio), firedOn: null }
  }

  if (auto.lastFiredOn === today) return parado
  // A comparação é textual porque as duas pontas são `HH:MM` com zero à
  // esquerda — "09:30" < "14:00" é verdade como string, e converter para número
  // só acrescentaria uma chance de erro.
  if (clinicClock(now, timezone) < auto.sendAtLocal) return parado
  return { rodar: true, windowFrom: new Date(janelaDoDia(today, timezone).de), firedOn: today }
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
      `tenant_id, timezone, corporate_name,
       automation_max_per_patient_day, automation_max_per_cycle,
       automation_window_start, automation_window_end, automation_weekdays`,
    )
  if (error) {
    logger.error({}, 'automations-load-tenants-failed')
    return total
  }

  for (const t of (tenants ?? []) as Array<TenantRow>) {
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
  tenant: TenantRow,
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

  const tz = tenant.timezone ?? DEFAULT_TZ
  const today = clinicToday(now, tz)

  /**
   * O que roda AGORA — resolvido antes de qualquer coisa cara.
   *
   * A ordem importa: as verificações de conexão do WhatsApp e de credencial
   * ficavam antes desta filtragem, e com o ciclo de 5 em 5 minutos isso
   * passaria a alertar "WhatsApp não conectado" 288 vezes por dia numa clínica
   * que não tem automação nenhuma para mandar hoje. Alerta que aparece sem haver
   * o que enviar ensina a clínica a ignorar alerta.
   */
  const naVez: Array<{
    auto: (typeof automacoes)[number]
    plano: Agendamento
    ancorada: boolean
  }> = []
  for (const auto of automacoes) {
    const fonte = getSource(auto.source)
    if (!fonte) {
      logger.warn({ tenantId, source: auto.source }, 'automations-unknown-source')
      continue
    }
    const ancorada = Boolean(fonte.isAnchored?.(auto.params))
    const plano = agendar(auto, ancorada, now, tz, today)
    if (plano.rodar) naVez.push({ auto, plano, ancorada })
  }
  if (naVez.length === 0) return r

  /**
   * A JANELA DE SILÊNCIO — a segunda metade da proteção contra bloqueio.
   *
   * O espaçamento resolve a rajada, mas cria um efeito que não existia quando
   * tudo saía de uma vez: uma fila longa escorre. A 5 minutos por mensagem, cem
   * pendentes ocupam mais de oito horas, e a cauda cai na madrugada — que é ao
   * mesmo tempo falta de educação com o paciente e sinal de robô para quem
   * observa o padrão de envio.
   *
   * A janela reusada é a MESMA que a clínica já configura em Lembretes
   * (08:00–20:00 de fábrica), e não uma configuração nova, porque a pergunta que
   * ela responde é a mesma: a que horas esta clínica fala com os pacientes dela.
   * Duas janelas separadas dariam à clínica a chance de responder diferente para
   * a mesma pergunta e descobrir a divergência pelo paciente reclamando.
   *
   * O que fica de fora da janela NÃO é perdido para as fontes de estado contínuo
   * (a chave é mensal) nem para as ancoradas (a janela de varredura não avança).
   * Para as fontes com chave do dia — aniversário é a que importa —, uma fila que
   * não vaza até as 20:00 perde a cauda: aquelas pessoas não são candidatas
   * amanhã. É o preço de não mandar parabéns às 3 da manhã, e a prévia avisa
   * quando o volume do dia passa do que cabe na janela.
   */
  const janelaInicio = (tenant.automation_window_start ?? '08:00').slice(0, 5)
  const janelaFim = (tenant.automation_window_end ?? '20:00').slice(0, 5)
  const agoraLocal = clinicClock(now, tz)
  const diaDaSemana = clinicWeekday(now, tz)
  const diasPermitidos = tenant.automation_weekdays ?? [1, 2, 3, 4, 5, 6]

  if (!diasPermitidos.includes(diaDaSemana)) {
    logger.info(
      { tenantId, diaDaSemana, diasPermitidos, aguardando: naVez.length },
      'automations-dia-nao-permitido',
    )
    return r
  }
  if (agoraLocal < janelaInicio || agoraLocal > janelaFim) {
    // UM registro por clínica por ciclo, e não um por automação: fora do
    // horário isso aconteceria 100 vezes por noite em toda clínica que tenha
    // qualquer automação ligada.
    logger.info(
      { tenantId, agoraLocal, janelaInicio, janelaFim, aguardando: naVez.length },
      'automations-fora-da-janela',
    )
    return r
  }

  /**
   * A ancorada passa na frente, e isso importa por causa do teto de espaçamento.
   *
   * Com uma mensagem por ciclo, quem chega primeiro leva a vaga. Uma automação
   * de aniversário com fila de vinte pessoas ocuparia a vaga de todos os ciclos
   * da manhã e empurraria para trás o "sua consulta é daqui a duas horas" — e
   * essa não pode esperar, porque a hora dela passa e não volta, enquanto o
   * parabéns atrasa e continua valendo. Entre as de mesma natureza, a ordem
   * segue a de criação, que é estável.
   */
  naVez.sort((a, b) => Number(b.ancorada) - Number(a.ancorada))

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

  const inicioDoDia = startOfClinicDayIso(today, tz)
  const clinicName = tenant.corporate_name ?? 'Clínica'

  let enviadasNoCiclo = 0

  // Um cache por CLÍNICA e por CICLO. Vive só o tempo desta função de propósito:
  // cache que atravessasse ciclos guardaria consentimento já revogado.
  const cache = new Map<string, unknown>()

  for (const { auto, plano } of naVez) {
    // A fonte já foi resolvida ao montar `naVez` — quem chegou aqui existe.
    const fonte = getSource(auto.source)
    if (!fonte) continue

    let candidatos
    try {
      candidatos = await fonte.enumerate({
        supabase,
        tenantId,
        today,
        now,
        windowFrom: plano.windowFrom,
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

    let suprimidasAqui = 0

    for (let i = 0; i < candidatos.length; i++) {
      const cand = candidatos[i] as (typeof candidatos)[number]

      /**
       * O TETO POR CICLO É O ESPAÇAMENTO, e é o que protege o número da clínica.
       *
       * Vinte aniversariantes num dia não podem sair em vinte mensagens
       * seguidas: rajada de número não-oficial é o caminho mais curto para o
       * bloqueio. Com o ciclo a cada 5 minutos e o teto de fábrica em 1, sai uma
       * mensagem por clínica a cada 5 minutos, e os vinte levam pouco menos de
       * duas horas — que é o preço de não ser bloqueado.
       *
       * O corte acontece ANTES de reservar a ocorrência, e isso mudou: antes o
       * excedente era reservado, marcado como suprimido e apagado em seguida,
       * três escritas por paciente por ciclo para não deixar rastro nenhum (a
       * linha suprimida é DELETADA, então nunca apareceu no histórico de 30
       * dias). Com o ciclo 12 vezes mais frequente, isso viraria dezenas de
       * milhares de escritas por dia numa clínica grande, para produzir nada. O
       * que ficou de fora continua contado no resultado do ciclo, que é onde
       * essa informação sempre viveu.
       */
      if (enviadasNoCiclo >= tenant.automation_max_per_cycle) {
        const restantes = candidatos.length - i
        r.suprimidas += restantes
        suprimidasAqui += restantes
        break
      }

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

      // Teto por paciente/dia.
      const jaHoje = await countSentToday(supabase, tenantId, cand.patientId, inicioDoDia, occId)
      if (jaHoje >= tenant.automation_max_per_patient_day) {
        await settleOccurrence(supabase, occId, 'suprimido_teto_paciente')
        await releaseSuppressed(supabase, occId)
        r.suprimidas++
        suprimidasAqui++
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

    /**
     * Só depois de a varredura terminar, e SÓ se ela terminou inteira.
     *
     * Quem parou no teto não registra nada: nem o dia (senão a promessa "fica
     * para o ciclo seguinte" viraria "fica para amanhã"), nem o instante da
     * varredura. O instante é o que mais importa e é o menos óbvio: a automação
     * ANCORADA enumera pela janela `(última varredura, agora]`, então avançar a
     * marca depois de atender só o primeiro da fila jogaria fora, para sempre,
     * os que ficaram — a janela deles passaria sem nunca ter sido olhada. Sem
     * avançar, a janela seguinte ainda os cobre, e quem já recebeu é barrado
     * pelo UNIQUE na hora de reservar.
     */
    if (suprimidasAqui === 0) {
      await markAutomationRan(supabase, auto.id, { ranAt: now, firedOn: plano.firedOn })
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
