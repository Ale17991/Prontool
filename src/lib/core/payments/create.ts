import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/observability/errors'

export type PaymentMethod =
  | 'dinheiro'
  | 'pix'
  | 'cartao_credito'
  | 'cartao_debito'
  | 'boleto'
  | 'convenio'
  | 'outro'

export type PaymentRecordStatus = 'pendente' | 'parcial' | 'pago' | 'cancelado'

export interface InstallmentSpec {
  /** 1-based. Se omitido, deduzido pela posição no array. */
  installmentNumber?: number
  amountCents: number
  /** YYYY-MM-DD */
  dueDate: string
  status?: 'pendente' | 'pago'
}

export interface CreatePaymentRecordInput {
  tenantId: string
  patientId: string
  appointmentId?: string | null
  treatmentStepId?: string | null
  totalAmountCents: number
  paymentMethod: PaymentMethod
  /** Se omitido, será dividido em parcelas mensais começando hoje. */
  installments?: InstallmentSpec[]
  /** Usado apenas quando installments não é informado. */
  installmentsCount?: number
  /** Status inicial — se 'pago' já marca todas as parcelas como pagas. */
  initialStatus?: 'pendente' | 'pago'
  /** Quando initialStatus='pago', registra a data do pagamento. */
  paidAt?: string | null
  notes?: string | null
  actorUserId: string
}

export interface CreatePaymentRecordResult {
  paymentRecordId: string
  installmentIds: string[]
}

export async function createPaymentRecord(
  supabase: SupabaseClient<Database>,
  input: CreatePaymentRecordInput,
): Promise<CreatePaymentRecordResult> {
  if (input.totalAmountCents < 0) {
    throw new ValidationError('totalAmountCents não pode ser negativo')
  }

  // Sanity: paciente pertence ao tenant
  const pat = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.patientId)
    .maybeSingle()
  if (pat.error) throw new Error(`patient lookup: ${pat.error.message}`)
  if (!pat.data) throw new NotFoundError('patient', input.patientId)

  const installments = normalizeInstallments(input)
  const totalFromInstallments = installments.reduce((acc, i) => acc + i.amountCents, 0)
  if (Math.abs(totalFromInstallments - input.totalAmountCents) > installments.length) {
    // Tolera diferença de até 1 centavo por parcela (arredondamento).
    throw new ValidationError(
      `Soma das parcelas (${totalFromInstallments}) não bate com total (${input.totalAmountCents})`,
    )
  }

  const allPaid = input.initialStatus === 'pago'
  const paidAt = allPaid ? (input.paidAt ?? new Date().toISOString()) : null

  const recordInsert = await supabase
    .from('payment_records')
    .insert({
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      appointment_id: input.appointmentId ?? null,
      treatment_step_id: input.treatmentStepId ?? null,
      total_amount_cents: input.totalAmountCents,
      installments: installments.length,
      payment_method: input.paymentMethod,
      payment_status: allPaid ? 'pago' : 'pendente',
      paid_amount_cents: allPaid ? input.totalAmountCents : 0,
      paid_at: paidAt,
      notes: input.notes ?? null,
      created_by: input.actorUserId,
    })
    .select('id')
    .single()
  if (recordInsert.error || !recordInsert.data) {
    throw new Error(`payment_records insert failed: ${recordInsert.error?.message}`)
  }
  const paymentRecordId = recordInsert.data.id

  const installmentRows = installments.map((inst, idx) => ({
    tenant_id: input.tenantId,
    payment_record_id: paymentRecordId,
    installment_number: inst.installmentNumber ?? idx + 1,
    amount_cents: inst.amountCents,
    due_date: inst.dueDate,
    status: allPaid ? 'pago' : (inst.status ?? 'pendente'),
    paid_at: allPaid ? paidAt : null,
    paid_amount_cents: allPaid ? inst.amountCents : 0,
    payment_method: allPaid ? input.paymentMethod : null,
  }))

  const installmentInsert = await supabase
    .from('payment_installments')
    .insert(installmentRows)
    .select('id')
  if (installmentInsert.error) {
    throw new Error(
      `payment_installments insert failed: ${installmentInsert.error.message}`,
    )
  }

  return {
    paymentRecordId,
    installmentIds: (installmentInsert.data ?? []).map((r) => r.id as string),
  }
}

function normalizeInstallments(input: CreatePaymentRecordInput): InstallmentSpec[] {
  if (input.installments && input.installments.length > 0) {
    return input.installments
  }
  const count = Math.max(1, input.installmentsCount ?? 1)
  if (count > 60) throw new ValidationError('Máximo 60 parcelas')
  // Divide o total em N parcelas; resto vai pra primeira parcela.
  const base = Math.floor(input.totalAmountCents / count)
  const remainder = input.totalAmountCents - base * count
  const today = new Date()
  return Array.from({ length: count }, (_, idx) => {
    const due = new Date(today)
    due.setMonth(due.getMonth() + idx)
    return {
      installmentNumber: idx + 1,
      amountCents: idx === 0 ? base + remainder : base,
      dueDate: toYmd(due),
    }
  })
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
