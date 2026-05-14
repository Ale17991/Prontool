import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import type { RecordPaymentTermsChangeInput } from '@/lib/core/payment-terms/types'

/**
 * Muda a modalidade de pagamento de um profissional via RPC
 * `record_payment_terms_change` — atomico: INSERT em
 * doctor_payment_terms_history + UPDATE de doctors.payment_mode.
 *
 * O proprio RPC valida JWT tenant + role admin, e o trigger de audit
 * registra a mudanca em audit_log com `field='version_created'` + reason.
 *
 * RBAC: o caller MUST ja ter passado por requireRole(['admin']).
 */
export interface UpdateDoctorPaymentModeResult {
  paymentTermsId: string
  paymentMode: 'comissionado' | 'fixo' | 'liberal'
}

export async function updateDoctorPaymentMode(
  supabase: SupabaseClient<Database>,
  input: RecordPaymentTermsChangeInput,
): Promise<UpdateDoctorPaymentModeResult> {
  // Validacoes basicas — server faz refine cruzado por modalidade.
  if (input.reason.trim().length < 3) {
    throw new ValidationError('Motivo deve ter ao menos 3 caracteres')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom)) {
    throw new ValidationError('valid_from deve estar no formato YYYY-MM-DD')
  }

  switch (input.paymentMode) {
    case 'comissionado':
      if (
        input.percentageBps == null ||
        input.percentageBps < 0 ||
        input.percentageBps > 10_000
      ) {
        throw new ValidationError('Comissão deve estar entre 0 e 10000 bps')
      }
      break
    case 'fixo':
      if (input.monthlyAmountCents == null || input.monthlyAmountCents <= 0) {
        throw new ValidationError('Valor mensal deve ser maior que zero')
      }
      if (
        input.billingDay == null ||
        input.billingDay < 1 ||
        input.billingDay > 28
      ) {
        throw new ValidationError('Dia de faturamento deve estar entre 1 e 28')
      }
      break
    case 'liberal':
      if (input.liberalDefaultCents == null || input.liberalDefaultCents <= 0) {
        throw new ValidationError('Valor padrão por participação deve ser maior que zero')
      }
      break
  }

  const { data, error } = await supabase.rpc('record_payment_terms_change' as never, {
    p_tenant_id: input.tenantId,
    p_doctor_id: input.doctorId,
    p_payment_mode: input.paymentMode,
    p_percentage_bps: input.percentageBps ?? null,
    p_monthly_amount_cents: input.monthlyAmountCents ?? null,
    p_billing_day: input.billingDay ?? null,
    p_liberal_default_cents: input.liberalDefaultCents ?? null,
    p_valid_from: input.validFrom,
    p_reason: input.reason.trim(),
    p_actor: input.actorUserId,
  } as never)

  if (error) {
    if (/VALID_FROM_FUTURE/.test(error.message)) {
      throw new ValidationError('Data de início não pode ser no futuro')
    }
    throw new Error(`updateDoctorPaymentMode failed: ${error.message}`)
  }

  return {
    paymentTermsId: data as unknown as string,
    paymentMode: input.paymentMode,
  }
}
