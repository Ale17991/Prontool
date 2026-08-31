/**
 * Tradução entre o status do Asaas, o status local da cobrança e o status de
 * assinatura da clínica (`tenant_entitlements.status`).
 *
 * Puro, sem I/O — é regra de negócio, não consulta, e precisa ser testável sem
 * subir banco nem tocar em rede.
 */

import type { AsaasPaymentStatus, ChargeStatus } from './asaas/types'

export type EntitlementStatus = 'trial' | 'active' | 'past_due' | 'canceled'

/**
 * Status do Asaas → status local.
 *
 * `CONFIRMED` e `RECEIVED` continuam DISTINTOS aqui de propósito: o primeiro é
 * "o cliente pagou, o dinheiro ainda não liquidou", o segundo é "caiu na
 * conta". Achatar os dois em "pago" faria o caixa da plataforma contar dinheiro
 * que ainda pode voltar por chargeback. Para LIBERAR ACESSO os dois valem — ver
 * `grantsAccess`, que é uma pergunta diferente e tem resposta própria.
 */
export function mapAsaasStatus(status: AsaasPaymentStatus | string): ChargeStatus {
  switch (status) {
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS':
    case 'DUNNING_REQUESTED':
      return 'pendente'
    case 'CONFIRMED':
      return 'confirmado'
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
    case 'DUNNING_RECEIVED':
      return 'recebido'
    case 'OVERDUE':
      return 'vencido'
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'estornado'
    default:
      // Status novo do Asaas não pode virar "recebido" por descuido: o padrão
      // seguro é o que NÃO libera acesso nem conta como receita.
      return 'pendente'
  }
}

/**
 * O cliente cumpriu a parte dele? É esta a pergunta que decide acesso — não
 * "o dinheiro liquidou". Cobrar de novo alguém que já pagou porque o boleto
 * ainda não compensou é o pior erro possível numa régua de cobrança.
 */
export function grantsAccess(status: ChargeStatus): boolean {
  return status === 'recebido' || status === 'confirmado'
}

/**
 * Efeito de uma cobrança sobre o status da assinatura da clínica.
 *
 * Devolve `null` quando a cobrança não deve mexer no status — pendente é o
 * estado normal de quem tem fatura em aberto dentro do prazo, e rebaixar por
 * isso suspenderia clínica adimplente todo mês no dia da emissão.
 *
 * `estornado` NÃO cancela: cancelamento é decisão comercial, tomada no /admin.
 * Estorno rebaixa para `past_due`, que é reversível e visível na tela de
 * inadimplentes — quem some da base tem que ser por escolha de alguém.
 */
export function entitlementStatusFor(status: ChargeStatus): EntitlementStatus | null {
  if (grantsAccess(status)) return 'active'
  if (status === 'vencido') return 'past_due'
  if (status === 'estornado') return 'past_due'
  return null
}

export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = {
  pendente: 'Aguardando pagamento',
  confirmado: 'Pago (em compensação)',
  recebido: 'Recebido',
  vencido: 'Vencido',
  estornado: 'Estornado',
  cancelado: 'Cancelado',
  falhou: 'Falhou',
}
