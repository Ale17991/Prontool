import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import type { PaymentMethod, PaymentRecordStatus } from './create'

export interface RecordInstallmentPaymentInput {
  tenantId: string
  paymentRecordId: string
  installmentId: string
  paidAmountCents: number
  paymentMethod: PaymentMethod
  /** ISO timestamp; default now. */
  paidAt?: string
}

/**
 * Marca uma parcela como paga e recalcula o status do payment_record pai
 * (parcial / pago). Operação não-idempotente — se já paga, retorna 409.
 */
export async function recordInstallmentPayment(
  supabase: SupabaseClient<Database>,
  input: RecordInstallmentPaymentInput,
): Promise<{
  installmentId: string
  recordStatus: PaymentRecordStatus
}> {
  if (input.paidAmountCents < 0) {
    throw new ValidationError('paidAmountCents não pode ser negativo')
  }

  const installmentRes = await supabase
    .from('payment_installments')
    .select('id, payment_record_id, amount_cents, status')
    .eq('id', input.installmentId)
    .eq('payment_record_id', input.paymentRecordId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (installmentRes.error) {
    throw new Error(`installment lookup failed: ${installmentRes.error.message}`)
  }
  if (!installmentRes.data) throw new NotFoundError('payment_installment', input.installmentId)
  if (installmentRes.data.status === 'pago') {
    throw new ConflictError('INSTALLMENT_ALREADY_PAID', 'Parcela já marcada como paga', {
      installment_id: input.installmentId,
    })
  }
  if (installmentRes.data.status === 'cancelado') {
    throw new ConflictError('INSTALLMENT_CANCELLED', 'Parcela cancelada — não pode ser quitada', {
      installment_id: input.installmentId,
    })
  }

  const paidAt = input.paidAt ?? new Date().toISOString()
  const updateInst = await supabase
    .from('payment_installments')
    .update({
      status: 'pago',
      paid_at: paidAt,
      paid_amount_cents: input.paidAmountCents,
      payment_method: input.paymentMethod,
    })
    .eq('id', input.installmentId)
    .eq('tenant_id', input.tenantId)
  if (updateInst.error) {
    throw new Error(`installment update failed: ${updateInst.error.message}`)
  }

  // Recalcula record-level: soma parcelas pagas; se total == total_amount → pago,
  // se >0 → parcial, senão → pendente.
  const allInstallments = await supabase
    .from('payment_installments')
    .select('amount_cents, paid_amount_cents, status')
    .eq('tenant_id', input.tenantId)
    .eq('payment_record_id', input.paymentRecordId)
  if (allInstallments.error) {
    throw new Error(`installments aggregate failed: ${allInstallments.error.message}`)
  }

  let paidSum = 0
  let totalSum = 0
  for (const row of allInstallments.data ?? []) {
    totalSum += Number(row.amount_cents)
    if (row.status === 'pago') paidSum += Number(row.paid_amount_cents)
  }

  const recordRes = await supabase
    .from('payment_records')
    .select('total_amount_cents')
    .eq('id', input.paymentRecordId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (!recordRes.data) throw new NotFoundError('payment_record', input.paymentRecordId)
  const recordTotal = Number(recordRes.data.total_amount_cents)

  let nextStatus: PaymentRecordStatus
  if (paidSum >= recordTotal && paidSum > 0) nextStatus = 'pago'
  else if (paidSum > 0) nextStatus = 'parcial'
  else nextStatus = 'pendente'

  void totalSum // mantido para diagnóstico futuro — somatório das parcelas

  const updateRecord = await supabase
    .from('payment_records')
    .update({
      payment_status: nextStatus,
      paid_amount_cents: paidSum,
      paid_at: nextStatus === 'pago' ? paidAt : null,
    })
    .eq('id', input.paymentRecordId)
    .eq('tenant_id', input.tenantId)
  if (updateRecord.error) {
    throw new Error(`payment_record update failed: ${updateRecord.error.message}`)
  }

  return { installmentId: input.installmentId, recordStatus: nextStatus }
}
