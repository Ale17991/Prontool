/** Feature 029 — erros de domínio do faturamento TISS. */

/** Certificado A1 inválido (senha errada, formato não-PKCS#12, expirado). */
export class TissInvalidCertificateError extends Error {
  readonly code = 'TISS_INVALID_CERTIFICATE'
  constructor(message: string) {
    super(message)
    this.name = 'TissInvalidCertificateError'
  }
}

/** Violação de regra de faturamento (ex.: lote com operadoras mistas). */
export class TissBillingRuleError extends Error {
  readonly code = 'TISS_BILLING_RULE'
  constructor(message: string) {
    super(message)
    this.name = 'TissBillingRuleError'
  }
}
