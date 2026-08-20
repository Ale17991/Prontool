/**
 * Feature 056 — fontes baseadas na agenda.
 *
 * Seis fontes, e elas se dividem em duas naturezas que se comportam de forma
 * oposta ao serem ligadas:
 *
 * **Pontuais** (`confirmacao_agendamento`, `pre_consulta`, `pos_atendimento`,
 * `falta_consulta`, `agendamento_cancelado`) descrevem um EVENTO que aconteceu
 * num dia. Ligar numa base grande não produz rajada: só entra quem teve o
 * evento naquele dia. A chave é o id do atendimento.
 *
 * **De estado contínuo** (`sem_retorno`) descreve uma SITUAÇÃO que persiste.
 * Ligada, todo mundo que já está nessa condição satisfaz o gatilho no MESMO
 * dia — e sem os tetos do motor isso vira uma rajada que derruba o número da
 * clínica. Daí a chave mensal: quem segue sem voltar não pode virar cobrança
 * diária.
 *
 * O status do atendimento vem de DUAS camadas distintas, e confundi-las erra:
 * `appointments_effective.effective_status` é a camada de registro
 * (agendado/confirmado/ativo/cancelado/estornado), enquanto
 * `appointment_flow.status` é a camada de recepção (aguardando, em consulta,
 * atendido, desmarcou). Falta é fato de recepção; cancelamento é fato de
 * registro.
 */

import { z } from 'zod'
import { registerSource } from './registry'
import {
  addDias,
  antecedenciaSchema,
  dataBr,
  dataHoraBr,
  duracaoTexto,
  ehAncorada,
  lerAntecedencia,
  eligiblePatients,
  emDias,
  horaBr,
  janelaAncorada,
  janelaDoDia,
  mesesAtras,
  pageAll,
  primeiroNome,
  MINUTOS_POR_DIA,
} from './shared'
import type { EnumerateContext, SourceCandidate } from '../types'

type Resposta = { data: unknown; error: { message: string } | null }

/** As colunas de contexto que quase toda fonte de agenda usa nas variáveis. */
const COLUNAS_CONTEXTO = 'doctors(full_name), procedures(display_name)'

interface ContextoAtendimento {
  doctors?: { full_name: string | null } | null
  procedures?: { display_name: string | null } | null
}

/** Variáveis derivadas do atendimento — vazias viram ausência, nunca lacuna. */
function variaveisDoAtendimento(
  a: ContextoAtendimento & { appointment_at: string },
  ctx: EnumerateContext,
): Record<string, string> {
  const vars: Record<string, string> = {
    data_consulta: dataHoraBr(a.appointment_at, ctx.timezone),
    data: dataBr(a.appointment_at, ctx.timezone),
    hora: horaBr(a.appointment_at, ctx.timezone),
  }
  // Só entram quando existem. Variável presente-porém-vazia faria o motor
  // renderizar " " no lugar do nome; ausente faz ele PULAR o envio (FR-006),
  // que é o comportamento certo.
  const prof = a.doctors?.full_name
  if (prof) vars.profissional = primeiroNome(prof)
  const proc = a.procedures?.display_name
  if (proc) vars.procedimento = proc
  return vars
}

// ---------------------------------------------------------------------------
// Confirmação de agendamento
// ---------------------------------------------------------------------------

registerSource({
  id: 'confirmacao_agendamento',
  label: 'Confirmação de agendamento',
  group: 'agenda',
  hint: 'Dispara no dia seguinte ao agendamento ser criado, confirmando o que ficou marcado.',
  paramsSchema: z.object({}).strict(),
  fields: [],
  variables: ['data_consulta', 'data', 'hora', 'profissional', 'procedimento'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    // Criados NO DIA ANTERIOR ao ciclo. O ciclo é diário, então "criado hoje"
    // perderia tudo que for agendado depois da execução.
    const { de, ate } = janelaDoDia(addDias(ctx.today, -1), ctx.timezone)

    const linhas = await pageAll<
      ContextoAtendimento & { id: string; patient_id: string; appointment_at: string }
    >(
      (from, to) =>
        ctx.supabase
          .from('appointments')
          .select(`id, patient_id, appointment_at, ${COLUNAS_CONTEXTO}`)
          .eq('tenant_id', ctx.tenantId)
          .gte('created_at', de)
          .lt('created_at', ate)
          .order('id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'confirmacao_agendamento',
    )

    return linhas
      .filter((a) => aptos.has(a.patient_id))
      .map((a) => ({
        patientId: a.patient_id,
        // Uma vez por ATENDIMENTO — dois agendamentos no mesmo dia são dois
        // eventos distintos e merecem duas confirmações.
        occurrenceKey: a.id,
        variables: variaveisDoAtendimento(a, ctx),
      }))
  },
})

// ---------------------------------------------------------------------------
// Véspera da consulta (orientação de preparo)
// ---------------------------------------------------------------------------

registerSource({
  id: 'pre_consulta',
  label: 'Antes da consulta',
  group: 'agenda',
  hint: 'Dispara antes da consulta, no intervalo que você escolher — dias, horas ou minutos. Serve para orientação de preparo: jejum, documentos, exames a levar.',
  /**
   * O aviso existe por causa do FR-026: o lembrete de consulta tem motor e tela
   * PRÓPRIOS (Configurações → Lembretes), e esta fonte olha para a mesma
   * agenda. Montada com o mesmo intervalo, o paciente recebe duas mensagens
   * quase iguais e a clínica não descobre por quê — porque as duas configurações
   * moram em telas diferentes.
   */
  warning:
    'O lembrete de consulta é outra coisa e fica em Configurações → Lembretes, com motor próprio. Use este gatilho para ORIENTAÇÃO (preparo, jejum, o que levar) e confira o intervalo configurado lá, para o paciente não receber duas mensagens sobre a mesma consulta.',
  // 15 minutos é o piso porque é o intervalo do ciclo: prometer "5 minutos
  // antes" seria prometer uma precisão que o motor não tem.
  paramsSchema: antecedenciaSchema(15, 60 * MINUTOS_POR_DIA),
  fields: [
    {
      name: 'antecedenciaMin',
      label: 'Com quanta antecedência',
      kind: 'duration',
      min: 15,
      max: 60 * MINUTOS_POR_DIA,
      defaultValue: 2 * MINUTOS_POR_DIA,
      hint: 'Em dias, sai no horário escolhido abaixo. Em horas ou minutos, sai contado a partir do horário da consulta — e aí o horário abaixo não se aplica.',
    },
  ],
  variables: ['data_consulta', 'data', 'hora', 'profissional', 'procedimento', 'antecedencia'],

  isAnchored: (p) => ehAncorada(lerAntecedencia(p)),

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const antecedenciaMin = lerAntecedencia(ctx.params)
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    // Duas leituras da mesma antecedência, e a diferença é visível ao paciente.
    // Em dias, o recorte é o DIA CIVIL inteiro da consulta e o envio sai no
    // horário que a clínica escolheu. Em horas ou minutos, o recorte é a janela
    // deste ciclo deslocada — a mensagem sai a tantas horas da consulta,
    // qualquer que seja a hora do dia.
    const { de, ate } = ehAncorada(antecedenciaMin)
      ? janelaAncorada(ctx, antecedenciaMin, 'antes')
      : janelaDoDia(addDias(ctx.today, emDias(antecedenciaMin)), ctx.timezone)

    // A view traz o status efetivo: consulta cancelada ou estornada não recebe
    // orientação de preparo — seria mandar a pessoa jejuar para nada.
    const linhas = await pageAll<
      ContextoAtendimento & {
        id: string | null
        patient_id: string | null
        appointment_at: string | null
        effective_status: string | null
      }
    >(
      (from, to) =>
        ctx.supabase
          .from('appointments_effective')
          .select(`id, patient_id, appointment_at, effective_status, ${COLUNAS_CONTEXTO}`)
          .eq('tenant_id', ctx.tenantId)
          .gte('appointment_at', de)
          .lt('appointment_at', ate)
          .order('id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'pre_consulta',
    )

    return linhas
      .filter(
        (a) =>
          a.id &&
          a.patient_id &&
          a.appointment_at &&
          aptos.has(a.patient_id) &&
          ['agendado', 'confirmado', 'ativo'].includes(a.effective_status ?? '') &&
          // Consulta que JÁ COMEÇOU não recebe aviso de preparo. Na operação
          // normal a janela nunca alcança o passado, mas ela é ancorada na
          // varredura anterior: depois de um deploy longo ou de o ciclo ficar
          // parado, o intervalo cresce e passa a incluir consulta que já
          // aconteceu. Avisar para jejuar depois do exame é pior que silêncio.
          // Na prévia o filtro não vale — ver `previewMode` em types.ts.
          (ctx.previewMode || Date.parse(a.appointment_at as string) > ctx.now.getTime()),
      )
      .map((a) => ({
        patientId: a.patient_id as string,
        occurrenceKey: a.id as string,
        variables: {
          ...variaveisDoAtendimento({ ...a, appointment_at: a.appointment_at as string }, ctx),
          antecedencia: duracaoTexto(antecedenciaMin),
        },
      }))
  },
})

// ---------------------------------------------------------------------------
// Pós-atendimento
// ---------------------------------------------------------------------------

registerSource({
  id: 'pos_atendimento',
  label: 'Depois do atendimento',
  group: 'agenda',
  hint: 'Dispara depois de um atendimento REALIZADO, no intervalo que você escolher. Serve para saber como a pessoa está, pedir avaliação ou reforçar orientação.',
  paramsSchema: antecedenciaSchema(15, 180 * MINUTOS_POR_DIA),
  fields: [
    {
      name: 'antecedenciaMin',
      label: 'Quanto tempo depois',
      kind: 'duration',
      min: 15,
      max: 180 * MINUTOS_POR_DIA,
      defaultValue: 1 * MINUTOS_POR_DIA,
      hint: 'Em horas, dá para pedir avaliação no fim do mesmo dia do atendimento.',
    },
  ],
  variables: ['data_consulta', 'data', 'hora', 'profissional', 'procedimento', 'antecedencia'],

  isAnchored: (p) => ehAncorada(lerAntecedencia(p)),

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const antecedenciaMin = lerAntecedencia(ctx.params)
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    // O corte é pela CONCLUSÃO, não pelo horário marcado: um atendimento
    // remarcado e realizado depois deve contar de quando aconteceu.
    const { de, ate } = ehAncorada(antecedenciaMin)
      ? janelaAncorada(ctx, antecedenciaMin, 'depois')
      : janelaDoDia(addDias(ctx.today, -emDias(antecedenciaMin)), ctx.timezone)

    const linhas = await pageAll<
      ContextoAtendimento & {
        id: string | null
        patient_id: string | null
        appointment_at: string | null
        completed_at: string | null
        effective_status: string | null
      }
    >(
      (from, to) =>
        ctx.supabase
          .from('appointments_effective')
          .select(
            `id, patient_id, appointment_at, completed_at, effective_status, ${COLUNAS_CONTEXTO}`,
          )
          .eq('tenant_id', ctx.tenantId)
          .gte('completed_at', de)
          .lt('completed_at', ate)
          .order('id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'pos_atendimento',
    )

    return linhas
      .filter(
        (a) =>
          a.id &&
          a.patient_id &&
          a.appointment_at &&
          aptos.has(a.patient_id) &&
          // Estornado é atendimento desfeito: perguntar "como foi?" sobre algo
          // que a clínica anulou é constrangedor para as duas partes.
          a.effective_status !== 'estornado',
      )
      .map((a) => ({
        patientId: a.patient_id as string,
        occurrenceKey: a.id as string,
        variables: {
          ...variaveisDoAtendimento({ ...a, appointment_at: a.appointment_at as string }, ctx),
          antecedencia: duracaoTexto(antecedenciaMin),
        },
      }))
  },
})

// ---------------------------------------------------------------------------
// Faltou à consulta
// ---------------------------------------------------------------------------

registerSource({
  id: 'falta_consulta',
  label: 'Paciente não compareceu',
  group: 'agenda',
  hint: 'Dispara depois de um atendimento marcado pela recepção como "desmarcou" na régua de fluxo, no intervalo que você escolher.',
  /**
   * A falta é registrada por uma PESSOA na recepção, no fluxo operacional
   * (0153). Isso a torna melhor evidência que uma inferência de ausência — mas
   * não a torna intenção: quem faltou pode ter tido emergência, e o dado não
   * distingue. A mensagem precisa oferecer remarcar, não cobrar.
   */
  warning:
    'A régua da recepção registra que o paciente NÃO CHEGOU — não o motivo. Escreva a mensagem oferecendo remarcar, nunca cobrando a ausência: quem faltou por emergência recebe a mesma mensagem de quem simplesmente não veio.',
  paramsSchema: antecedenciaSchema(0, 30 * MINUTOS_POR_DIA),
  fields: [
    {
      name: 'antecedenciaMin',
      label: 'Quanto tempo depois do horário perdido',
      kind: 'duration',
      min: 0,
      max: 30 * MINUTOS_POR_DIA,
      defaultValue: 1 * MINUTOS_POR_DIA,
      hint: 'Em horas, alcança a pessoa ainda no dia — quando remarcar para a mesma semana ainda é possível.',
    },
  ],
  variables: ['data_consulta', 'data', 'hora', 'profissional', 'procedimento'],

  isAnchored: (p) => ehAncorada(lerAntecedencia(p)),

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const antecedenciaMin = lerAntecedencia(ctx.params)
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const { de, ate } = ehAncorada(antecedenciaMin)
      ? janelaAncorada(ctx, antecedenciaMin, 'depois')
      : janelaDoDia(addDias(ctx.today, -emDias(antecedenciaMin)), ctx.timezone)

    const linhas = await pageAll<{
      appointment_id: string
      appointments:
        | (ContextoAtendimento & {
            patient_id: string
            appointment_at: string
          })
        | null
    }>(
      (from, to) =>
        ctx.supabase
          .from('appointment_flow')
          .select(
            `appointment_id, appointments!inner(patient_id, appointment_at, ${COLUNAS_CONTEXTO})`,
          )
          .eq('tenant_id', ctx.tenantId)
          .eq('status', 'desmarcou')
          .gte('appointments.appointment_at', de)
          .lt('appointments.appointment_at', ate)
          .order('appointment_id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'falta_consulta',
    )

    const out: SourceCandidate[] = []
    for (const f of linhas) {
      const a = f.appointments
      if (!a || !aptos.has(a.patient_id)) continue
      out.push({
        patientId: a.patient_id,
        occurrenceKey: f.appointment_id,
        variables: variaveisDoAtendimento(a, ctx),
      })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Agendamento cancelado
// ---------------------------------------------------------------------------

registerSource({
  id: 'agendamento_cancelado',
  label: 'Agendamento cancelado',
  group: 'agenda',
  hint: 'Dispara no dia seguinte ao cancelamento, para confirmar que a consulta caiu e convidar a remarcar.',
  paramsSchema: z.object({}).strict(),
  fields: [],
  variables: ['data_consulta', 'data', 'hora', 'profissional', 'procedimento'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const { de, ate } = janelaDoDia(addDias(ctx.today, -1), ctx.timezone)

    const linhas = await pageAll<{
      appointment_id: string
      appointments:
        | (ContextoAtendimento & {
            patient_id: string
            appointment_at: string
          })
        | null
    }>(
      (from, to) =>
        ctx.supabase
          .from('appointment_cancellations')
          .select(
            `appointment_id, appointments!inner(patient_id, appointment_at, ${COLUNAS_CONTEXTO})`,
          )
          .eq('tenant_id', ctx.tenantId)
          .gte('cancelled_at', de)
          .lt('cancelled_at', ate)
          .order('appointment_id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'agendamento_cancelado',
    )

    const out: SourceCandidate[] = []
    for (const c of linhas) {
      const a = c.appointments
      if (!a || !aptos.has(a.patient_id)) continue
      out.push({
        patientId: a.patient_id,
        occurrenceKey: c.appointment_id,
        variables: variaveisDoAtendimento(a, ctx),
      })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Paciente sem retorno
// ---------------------------------------------------------------------------

registerSource({
  id: 'sem_retorno',
  label: 'Paciente sem retorno há N meses',
  group: 'agenda',
  hint: 'Dispara para quem não tem atendimento desde N meses atrás. Repete no máximo uma vez por mês.',
  warning:
    'Este gatilho descreve uma SITUAÇÃO, não um evento: ao ativar, todo mundo que já está nessa condição entra de uma vez. Confira a prévia antes — o teto por ciclo vai segurar o excedente, mas a fila pode levar dias para vazar.',
  paramsSchema: z.object({ meses: z.number().int().min(1).max(60) }).strict(),
  fields: [
    {
      name: 'meses',
      label: 'Meses sem atendimento',
      kind: 'number',
      min: 1,
      max: 60,
      defaultValue: 6,
      hint: 'Contado por calendário: 6 meses a partir de 15/03 é 15/09, não 180 dias.',
    },
  ],
  variables: ['meses'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { meses } = ctx.params as { meses: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const corte = mesesAtras(ctx.today, meses)

    // Quem TEVE atendimento depois do corte está fora. Uma consulta só é
    // suficiente para tirar a pessoa da lista.
    const recentesLinhas = await pageAll<{ patient_id: string }>(
      (from, to) =>
        ctx.supabase
          .from('appointments')
          .select('patient_id')
          .eq('tenant_id', ctx.tenantId)
          .gte('appointment_at', `${corte}T00:00:00.000Z`)
          .order('patient_id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'sem_retorno',
    )
    const recentes = new Set(recentesLinhas.map((a) => a.patient_id))

    const out: SourceCandidate[] = []
    for (const patientId of aptos) {
      if (recentes.has(patientId)) continue
      out.push({
        patientId,
        // Chave MENSAL: quem segue sem voltar recebe no máximo uma vez por mês,
        // não todo dia. Estado contínuo precisa de freio próprio.
        occurrenceKey: ctx.today.slice(0, 7),
        variables: { meses: String(meses) },
      })
    }
    return out
  },
})
