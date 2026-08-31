/**
 * Tipos do contrato com o Asaas (API v3) e do nosso domínio de cobrança.
 *
 * O Asaas fala em REAIS decimais (`value: 149.9`) e nós falamos em CENTAVOS
 * inteiros em todo o resto do sistema. A conversão vive num lugar só
 * (`money.ts`) e o limite é esta cápsula: nada fora de `billing/asaas/`
 * manipula `value` decimal.
 */

/** Ambiente da conta Asaas da plataforma. */
export type AsaasEnvironment = 'sandbox' | 'production'

/** Formas de cobrança oferecidas na fatura. */
export type AsaasBillingType = 'UNDEFINED' | 'PIX' | 'BOLETO' | 'CREDIT_CARD'

/** Periodicidade da assinatura. */
export type AsaasCycle = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY'

/**
 * Status de cobrança do Asaas que nos interessam.
 *
 * `CONFIRMED` ≠ `RECEIVED`: o primeiro é "o cliente pagou, o dinheiro ainda
 * não liquidou" (cartão, boleto em compensação) e o segundo é "caiu na conta".
 * Tratar os dois como a mesma coisa faria o fluxo de caixa da plataforma
 * enxergar dinheiro que ainda pode voltar — mas para LIBERAR ACESSO os dois
 * valem, porque o cliente cumpriu a parte dele.
 */
export type AsaasPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS'

/** Status local espelhado (o CHECK de `billing_charges.status`). */
export type ChargeStatus =
  | 'pendente'
  | 'confirmado'
  | 'recebido'
  | 'vencido'
  | 'estornado'
  | 'cancelado'
  | 'falhou'

/**
 * Uma parcela do split, já no formato do Asaas.
 *
 * `percentualValue` e `fixedValue` são mutuamente exclusivos — o Asaas aceita
 * os dois no mesmo objeto e o resultado é indefinido. A exclusão é garantida
 * na origem (CHECK `billing_partners_one_split_mode`) e aqui pelo tipo.
 */
export type AsaasSplit =
  | { walletId: string; percentualValue: number }
  | { walletId: string; fixedValue: number }

export interface AsaasCustomer {
  id: string
  name: string
  cpfCnpj: string | null
  email: string | null
  externalReference: string | null
}

export interface AsaasSubscription {
  id: string
  customer: string
  value: number
  cycle: AsaasCycle
  billingType: AsaasBillingType
  nextDueDate: string
  status: string
  externalReference: string | null
}

export interface AsaasPayment {
  id: string
  customer: string
  subscription: string | null
  value: number
  netValue: number | null
  status: AsaasPaymentStatus
  billingType: string | null
  dueDate: string
  paymentDate: string | null
  clientPaymentDate: string | null
  invoiceUrl: string | null
  bankSlipUrl: string | null
  externalReference: string | null
}

/** QR do PIX — buscado sob demanda, nunca persistido (o payload expira). */
export interface AsaasPixQrCode {
  /** PNG em base64, sem o prefixo `data:`. */
  encodedImage: string
  /** "Copia e cola". */
  payload: string
  expirationDate: string | null
}
