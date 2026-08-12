/**
 * Feature 056 — fontes baseadas em parcelas do financeiro.
 *
 * São as duas fontes mais delicadas do conjunto, e não por dificuldade técnica:
 * o recorte é uma data de vencimento, o que é trivial. O risco é de OUTRA
 * ordem.
 *
 * Mensagem de cobrança tem regra própria no Código de Defesa do Consumidor
 * (art. 42): não pode expor o consumidor a ridículo nem submetê-lo a
 * constrangimento ou ameaça. Somado ao sigilo da relação clínica — o WhatsApp
 * pode estar num aparelho compartilhado, e a mensagem aparece na tela de
 * bloqueio —, isso significa que o texto NÃO deve nomear o procedimento nem o
 * profissional. Por isso as variáveis destas duas fontes são valor e data, e
 * nada mais: o que a fonte não fornece, a clínica não consegue escrever, e a
 * validação de variável recusa na hora de montar (FR-005).
 *
 * A decisão de limitar as variáveis é o guarda-corpo; o `warning` é o aviso.
 */

import { z } from 'zod'
import { registerSource } from './registry'
import { addDias, dataCivilBr, eligiblePatients, moedaBr, pageAll } from './shared'
import type { EnumerateContext, SourceCandidate } from '../types'

type Resposta = { data: unknown; error: { message: string } | null }

/** Nem pago, nem cancelado — o que ainda deve. */
const EM_ABERTO = ['pendente', 'atrasado', 'parcial', 'inadimplencia']

interface ParcelaLinha {
  id: string
  due_date: string
  amount_cents: number
  paid_amount_cents: number
  installment_number: number
  payment_records: { patient_id: string } | null
}

async function parcelasVencendoEm(
  ctx: EnumerateContext,
  dia: string,
  rotulo: string,
): Promise<ParcelaLinha[]> {
  return pageAll<ParcelaLinha>(
    (from, to) =>
      ctx.supabase
        .from('payment_installments')
        .select(
          'id, due_date, amount_cents, paid_amount_cents, installment_number, payment_records!inner(patient_id)',
        )
        .eq('tenant_id', ctx.tenantId)
        // `due_date` é coluna DATE: comparação direta com o dia civil da
        // clínica, sem fuso no meio. Converter para timestamp aqui só criaria
        // uma chance de errar a borda.
        .eq('due_date', dia)
        .in('status', EM_ABERTO)
        .order('id')
        .range(from, to) as unknown as PromiseLike<Resposta>,
    rotulo,
  )
}

function variaveis(p: ParcelaLinha): Record<string, string> {
  return {
    // O que FALTA, não o valor original: parcela paga pela metade cobrada pelo
    // total é erro que o paciente percebe na hora e a clínica descobre no
    // atrito.
    valor: moedaBr(Math.max(0, p.amount_cents - p.paid_amount_cents)),
    vencimento: dataCivilBr(p.due_date),
    parcela: String(p.installment_number),
  }
}

// ---------------------------------------------------------------------------
// Parcela a vencer
// ---------------------------------------------------------------------------

registerSource({
  id: 'parcela_a_vencer',
  label: 'Parcela a vencer em N dias',
  group: 'financeiro',
  hint: 'Dispara N dias antes do vencimento de uma parcela em aberto. Um lembrete, não uma cobrança.',
  paramsSchema: z.object({ dias: z.number().int().min(0).max(30) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Quantos dias antes do vencimento',
      kind: 'number',
      min: 0,
      max: 30,
      defaultValue: 3,
      hint: '0 avisa no próprio dia do vencimento.',
    },
  ],
  variables: ['valor', 'vencimento', 'parcela', 'dias'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { dias } = ctx.params as { dias: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const parcelas = await parcelasVencendoEm(ctx, addDias(ctx.today, dias), 'parcela_a_vencer')

    return parcelas
      .filter((p) => p.payment_records && aptos.has(p.payment_records.patient_id))
      .map((p) => ({
        patientId: (p.payment_records as { patient_id: string }).patient_id,
        // Uma vez por PARCELA. Duas parcelas vencendo no mesmo dia são dois
        // avisos — e é o teto por paciente/dia que decide se ambos saem.
        occurrenceKey: p.id,
        variables: { ...variaveis(p), dias: String(dias) },
      }))
  },
})

// ---------------------------------------------------------------------------
// Parcela vencida
// ---------------------------------------------------------------------------

registerSource({
  id: 'parcela_vencida',
  label: 'Parcela vencida há N dias',
  group: 'financeiro',
  hint: 'Dispara N dias depois do vencimento, se a parcela seguir em aberto.',
  /**
   * O aviso é normativo, não estilístico: o art. 42 do CDC proíbe expor o
   * consumidor inadimplente a constrangimento, e o WhatsApp entrega na tela de
   * bloqueio de um aparelho que pode não ser só dele.
   */
  warning:
    'Cobrança tem limite legal (art. 42 do CDC): a mensagem não pode constranger nem ameaçar. E o WhatsApp aparece na tela de bloqueio de um aparelho que talvez não seja só do paciente — por isso este gatilho NÃO fornece o procedimento nem o profissional, só valor e data. Prefira "há um valor em aberto, posso ajudar?" a qualquer texto que nomeie o tratamento.',
  paramsSchema: z.object({ dias: z.number().int().min(1).max(180) }).strict(),
  fields: [
    {
      name: 'dias',
      label: 'Quantos dias depois do vencimento',
      kind: 'number',
      min: 1,
      max: 180,
      defaultValue: 3,
    },
  ],
  variables: ['valor', 'vencimento', 'parcela', 'dias'],

  async enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]> {
    const { dias } = ctx.params as { dias: number }
    const aptos = await eligiblePatients(ctx)
    if (aptos.size === 0) return []

    const parcelas = await parcelasVencendoEm(ctx, addDias(ctx.today, -dias), 'parcela_vencida')

    return parcelas
      .filter((p) => p.payment_records && aptos.has(p.payment_records.patient_id))
      .map((p) => ({
        patientId: (p.payment_records as { patient_id: string }).patient_id,
        /**
         * A chave é a parcela MAIS o dia do aviso. Aqui o `dias` está no
         * recorte, então cada parcela cai numa janela só — mas se a clínica
         * montar dois gatilhos (3 dias e 15 dias) sobre a mesma parcela, eles
         * são automações distintas e cada uma tem sua própria linha. A chave
         * composta deixa isso explícito em vez de depender do id da automação
         * para desempatar.
         */
        occurrenceKey: `${p.id}:${dias}`,
        variables: { ...variaveis(p), dias: String(dias) },
      }))
  },
})
