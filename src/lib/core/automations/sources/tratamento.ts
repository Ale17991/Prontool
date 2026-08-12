/**
 * Feature 056 — fontes sobre tratamento proposto e exames pedidos.
 *
 * As três olham para algo que a clínica ENTREGOU ao paciente e que ficou sem
 * desfecho: um orçamento apresentado e não respondido, uma etapa de tratamento
 * aprovada e nunca marcada, um pedido de exame que não voltou.
 *
 * O ponto comum é que a ausência de desfecho no sistema não prova ausência de
 * desfecho no mundo — o paciente pode ter feito o exame em outro laboratório e
 * nunca trazido o papel. Por isso nenhuma das três afirma inércia do paciente;
 * as mensagens são de retomada, e os avisos dizem isso a quem escreve.
 */

import { z } from 'zod'
import { registerSource } from './registry'
import { addDias, dataCivilBr, eligiblePatients, janelaDoDia, moedaBr, pageAll } from './shared'
import type { EnumerateContext, SourceCandidate } from '../types'

type Resposta = { data: unknown; error: { message: string } | null }

// ---------------------------------------------------------------------------
// Orçamento apresentado sem resposta
// ---------------------------------------------------------------------------

registerSource({
  id: 'orcamento_sem_resposta',
  label: 'Orçamento apresentado sem resposta há N dias',
  group: 'tratamento',
  hint: 'Dispara N dias depois de um orçamento ser apresentado, se ele ainda não foi aceito nem recusado.',
  paramsSchema: z.object({ dias: z.number().int().min(1).max(180) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Dias desde a apresentação',
      kind: 'number',
      min: 1,
      max: 180,
      defaultValue: 7,
    },
  ],
  variables: ['valor', 'orcamento', 'dias', 'apresentado_em'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { dias } = ctx.params as { dias: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const { de, ate } = janelaDoDia(addDias(ctx.today, -dias), ctx.timezone)

    const orcamentos = await pageAll<{
      id: string
      patient_id: string
      title: string | null
      frozen_total_cents: number | null
      presented_at: string | null
      status: string
    }>(
      (from, to) =>
        ctx.supabase
          .from('treatment_budgets')
          .select('id, patient_id, title, frozen_total_cents, presented_at, status')
          .eq('tenant_id', ctx.tenantId)
          .eq('status', 'apresentado')
          .is('accepted_at', null)
          .is('refused_at', null)
          .gte('presented_at', de)
          .lt('presented_at', ate)
          .order('id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'orcamento_sem_resposta',
    )

    const out: SourceCandidate[] = []
    for (const o of orcamentos) {
      if (!aptos.has(o.patient_id)) continue
      const vars: Record<string, string> = {
        dias: String(dias),
        apresentado_em: dataCivilBr((o.presented_at ?? '').slice(0, 10)),
      }
      // Orçamento sem valor congelado existe (rascunho apresentado na tela).
      // A variável fica AUSENTE, não zerada: "R$ 0,00" num orçamento é pior que
      // não mandar, e ausente faz o motor pular o envio (FR-006).
      if (o.frozen_total_cents !== null && o.frozen_total_cents !== undefined) {
        vars.valor = moedaBr(o.frozen_total_cents)
      }
      if (o.title) vars.orcamento = o.title

      out.push({ patientId: o.patient_id, occurrenceKey: o.id, variables: vars })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Etapa de tratamento sem agendamento
// ---------------------------------------------------------------------------

registerSource({
  id: 'etapa_sem_agendamento',
  label: 'Etapa de tratamento pendente sem data marcada',
  group: 'tratamento',
  hint: 'Dispara para quem tem etapa de tratamento pendente, sem data marcada, parada há mais de N dias. Repete no máximo uma vez por mês.',
  warning:
    'Este gatilho descreve uma SITUAÇÃO: ao ativar, todo mundo com etapa parada entra de uma vez. Confira a prévia antes — o teto por ciclo segura o excedente, mas a fila pode levar dias.',
  paramsSchema: z.object({ dias: z.number().int().min(7).max(365) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Dias parada sem agendar',
      kind: 'number',
      min: 7,
      max: 365,
      defaultValue: 30,
    },
  ],
  variables: ['dias', 'etapa', 'etapas_pendentes'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { dias } = ctx.params as { dias: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const corte = janelaDoDia(addDias(ctx.today, -dias), ctx.timezone).ate

    const etapas = await pageAll<{
      id: string
      patient_id: string
      title: string
      created_at: string
    }>(
      (from, to) =>
        ctx.supabase
          .from('treatment_plan_steps')
          .select('id, patient_id, title, created_at')
          .eq('tenant_id', ctx.tenantId)
          .eq('status', 'pendente')
          .is('scheduled_date', null)
          .is('deleted_at', null)
          .lt('created_at', corte)
          .order('id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'etapa_sem_agendamento',
    )

    // Uma mensagem por PACIENTE, não por etapa: quem tem cinco dentes para
    // tratar receberia cinco mensagens iguais no mesmo dia, e o teto por
    // paciente barraria quatro delas — gastando quatro linhas de supressão para
    // chegar no resultado que agrupar aqui produz de graça.
    const porPaciente = new Map<string, { titulos: string[]; maisAntiga: string }>()
    for (const e of etapas) {
      if (!aptos.has(e.patient_id)) continue
      const atual = porPaciente.get(e.patient_id)
      if (!atual) {
        porPaciente.set(e.patient_id, { titulos: [e.title], maisAntiga: e.created_at })
      } else {
        atual.titulos.push(e.title)
        if (e.created_at < atual.maisAntiga) atual.maisAntiga = e.created_at
      }
    }

    const out: SourceCandidate[] = []
    for (const [patientId, info] of porPaciente) {
      out.push({
        patientId,
        // Chave MENSAL: estado contínuo, mesmo freio de `sem_retorno`.
        occurrenceKey: ctx.today.slice(0, 7),
        variables: {
          dias: String(dias),
          etapa: info.titulos[0] ?? '',
          etapas_pendentes: String(info.titulos.length),
        },
      })
    }
    return out
  },
})

// ---------------------------------------------------------------------------
// Pedido de exame sem retorno
// ---------------------------------------------------------------------------

registerSource({
  id: 'exame_sem_retorno',
  label: 'Pedido de exame emitido há N dias',
  group: 'tratamento',
  hint: 'Dispara N dias depois de um pedido de exame ser emitido, para lembrar de agendar ou trazer o resultado.',
  /**
   * O sistema sabe que o pedido foi EMITIDO. Não sabe se o exame foi feito: o
   * paciente pode ter ido a um laboratório que não devolve resultado para cá.
   * Escrever "você não fez o exame" seria afirmar o que o dado não sustenta —
   * a mesma armadilha do checklist (FR-009), noutra roupa.
   */
  warning:
    'O sistema sabe que o pedido foi EMITIDO, não se o exame foi feito: o paciente pode ter ido a um laboratório que não devolve resultado para cá. Escreva como lembrete de trazer o resultado, nunca como "você não fez".',
  paramsSchema: z.object({ dias: z.number().int().min(1).max(180) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Dias desde a emissão',
      kind: 'number',
      min: 1,
      max: 180,
      defaultValue: 15,
    },
  ],
  variables: ['dias', 'emitido_em'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { dias } = ctx.params as { dias: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const alvo = addDias(ctx.today, -dias)
    const { de, ate } = janelaDoDia(alvo, ctx.timezone)

    const pedidos = await pageAll<{ id: string; patient_id: string; issued_at: string | null }>(
      (from, to) =>
        ctx.supabase
          .from('exam_requests')
          .select('id, patient_id, issued_at')
          .eq('tenant_id', ctx.tenantId)
          .is('deleted_at', null)
          .gte('issued_at', de)
          .lt('issued_at', ate)
          .order('id')
          .range(from, to) as unknown as PromiseLike<Resposta>,
      'exame_sem_retorno',
    )

    return pedidos
      .filter((p) => aptos.has(p.patient_id))
      .map((p) => ({
        patientId: p.patient_id,
        occurrenceKey: p.id,
        variables: { dias: String(dias), emitido_em: dataCivilBr(alvo) },
      }))
  },
})
