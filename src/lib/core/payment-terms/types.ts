/**
 * Types compartilhados da feature 013 — modalidades de pagamento.
 *
 * Espelha o ENUM `public.payment_mode` e a forma do head-of-chain
 * `doctor_payment_terms_current`. Mantido aqui (e nao em `db/types.ts`)
 * porque a tabela `doctor_payment_terms_history` tem CHECK por modalidade
 * que sobrepoe a forma "tudo nullable" do generated types — esses types
 * domestic representam o shape ja validado.
 */

export type PaymentMode = 'comissionado' | 'fixo' | 'liberal'

/** Linha vigente em `doctor_payment_terms_current` para um doctor. */
export interface PaymentTermsCurrent {
  doctorId: string
  paymentMode: PaymentMode
  /** Preenchido apenas quando `paymentMode = 'comissionado'`. */
  percentageBps: number | null
  /** Preenchido apenas quando `paymentMode = 'fixo'`. */
  monthlyAmountCents: number | null
  /** Preenchido apenas quando `paymentMode = 'fixo'`. Inteiro 1–28. */
  billingDay: number | null
  /** Preenchido apenas quando `paymentMode = 'liberal'`. */
  liberalDefaultCents: number | null
  validFrom: string // YYYY-MM-DD
  createdAt: string // ISO timestamp
}

/** Uma versao em `doctor_payment_terms_history`. */
export interface PaymentTermsRow extends PaymentTermsCurrent {
  id: string
  tenantId: string
  reason: string
  createdBy: string
}

/** Input para a RPC `record_payment_terms_change`. */
export interface RecordPaymentTermsChangeInput {
  tenantId: string
  doctorId: string
  paymentMode: PaymentMode
  /** Necessario quando `paymentMode = 'comissionado'`. */
  percentageBps?: number | null
  /** Necessario quando `paymentMode = 'fixo'`. */
  monthlyAmountCents?: number | null
  /** Necessario quando `paymentMode = 'fixo'`. */
  billingDay?: number | null
  /** Necessario quando `paymentMode = 'liberal'`. */
  liberalDefaultCents?: number | null
  /** Data efetiva da nova versao; rejeitada se > hoje. */
  validFrom: string // YYYY-MM-DD
  /** Motivo obrigatorio (3–500 chars), gravado em audit_log. */
  reason: string
  actorUserId: string
}
