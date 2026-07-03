import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface PaymentInstallmentDTO {
  id: string
  installmentNumber: number
  amountCents: number
  dueDate: string
  status: 'pendente' | 'pago' | 'atrasado' | 'cancelado'
  paidAt: string | null
  paidAmountCents: number
  paymentMethod: string | null
  /** Computado: pendente com vencimento < hoje. */
  isOverdue: boolean
}

export interface PaymentRecordDTO {
  id: string
  tenantId: string
  patientId: string
  appointmentId: string | null
  treatmentStepId: string | null
  totalAmountCents: number
  paidAmountCents: number
  pendingAmountCents: number
  overdueAmountCents: number
  installmentsCount: number
  paymentMethod: string
  paymentStatus: string
  paidAt: string | null
  notes: string | null
  createdAt: string
  installments: PaymentInstallmentDTO[]
  procedureLabel: string | null
}

export interface PatientFinancialSummary {
  totalAmountCents: number
  paidAmountCents: number
  pendingAmountCents: number
  overdueAmountCents: number
  recordCount: number
}

interface PaymentRecordRow {
  id: string
  tenant_id: string
  patient_id: string
  appointment_id: string | null
  treatment_step_id: string | null
  total_amount_cents: number
  paid_amount_cents: number
  installments: number
  payment_method: string
  payment_status: string
  paid_at: string | null
  notes: string | null
  created_at: string
  appointments?: {
    procedures?: { tuss_code: string; display_name: string | null } | null
  } | null
  treatment_plan_steps?: {
    title?: string | null
    procedures?: { tuss_code: string; display_name: string | null } | null
  } | null
}

interface InstallmentRow {
  id: string
  payment_record_id: string
  installment_number: number
  amount_cents: number
  due_date: string
  status: string
  paid_at: string | null
  paid_amount_cents: number
  payment_method: string | null
}

export async function listPaymentsForPatient(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; patientId: string },
): Promise<{ records: PaymentRecordDTO[]; summary: PatientFinancialSummary }> {
  const records = await supabase
    .from('payment_records')
    .select(
      'id, tenant_id, patient_id, appointment_id, treatment_step_id, ' +
        'total_amount_cents, paid_amount_cents, installments, payment_method, ' +
        'payment_status, paid_at, notes, created_at, ' +
        'appointments:appointment_id ( procedures:procedure_id ( tuss_code, display_name ) ), ' +
        'treatment_plan_steps:treatment_step_id ( title, procedures:procedure_id ( tuss_code, display_name ) )',
    )
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .order('created_at', { ascending: false })
  if (records.error) throw new Error(`payment_records list failed: ${records.error.message}`)

  const recordRows = (records.data ?? []) as unknown as PaymentRecordRow[]
  if (recordRows.length === 0) {
    return {
      records: [],
      summary: {
        totalAmountCents: 0,
        paidAmountCents: 0,
        pendingAmountCents: 0,
        overdueAmountCents: 0,
        recordCount: 0,
      },
    }
  }

  const recordIds = recordRows.map((r) => r.id)
  const installments = await supabase
    .from('payment_installments')
    .select('*')
    .eq('tenant_id', args.tenantId)
    .in('payment_record_id', recordIds)
    .order('installment_number', { ascending: true })
  if (installments.error) {
    throw new Error(`payment_installments list failed: ${installments.error.message}`)
  }

  const today = new Date().toISOString().slice(0, 10)
  const installmentsByRecord = new Map<string, PaymentInstallmentDTO[]>()
  for (const row of (installments.data ?? []) as unknown as InstallmentRow[]) {
    const isOverdue = row.status === 'pendente' && row.due_date < today
    const dto: PaymentInstallmentDTO = {
      id: row.id,
      installmentNumber: row.installment_number,
      amountCents: Number(row.amount_cents),
      dueDate: row.due_date,
      status: row.status as PaymentInstallmentDTO['status'],
      paidAt: row.paid_at,
      paidAmountCents: Number(row.paid_amount_cents),
      paymentMethod: row.payment_method,
      isOverdue,
    }
    const existing = installmentsByRecord.get(row.payment_record_id) ?? []
    existing.push(dto)
    installmentsByRecord.set(row.payment_record_id, existing)
  }

  let totalAll = 0
  let paidAll = 0
  let pendingAll = 0
  let overdueAll = 0

  const dtos: PaymentRecordDTO[] = recordRows.map((r) => {
    const insts = installmentsByRecord.get(r.id) ?? []
    const pending = insts
      .filter((i) => i.status === 'pendente')
      .reduce((acc, i) => acc + i.amountCents - i.paidAmountCents, 0)
    const overdue = insts
      .filter((i) => i.isOverdue)
      .reduce((acc, i) => acc + i.amountCents - i.paidAmountCents, 0)
    const procedureLabel = pickProcedureLabel(r)

    totalAll += Number(r.total_amount_cents)
    paidAll += Number(r.paid_amount_cents)
    pendingAll += pending
    overdueAll += overdue

    return {
      id: r.id,
      tenantId: r.tenant_id,
      patientId: r.patient_id,
      appointmentId: r.appointment_id,
      treatmentStepId: r.treatment_step_id,
      totalAmountCents: Number(r.total_amount_cents),
      paidAmountCents: Number(r.paid_amount_cents),
      pendingAmountCents: pending,
      overdueAmountCents: overdue,
      installmentsCount: r.installments,
      paymentMethod: r.payment_method,
      paymentStatus: r.payment_status,
      paidAt: r.paid_at,
      notes: r.notes,
      createdAt: r.created_at,
      installments: insts,
      procedureLabel,
    }
  })

  return {
    records: dtos,
    summary: {
      totalAmountCents: totalAll,
      paidAmountCents: paidAll,
      pendingAmountCents: pendingAll,
      overdueAmountCents: overdueAll,
      recordCount: dtos.length,
    },
  }
}

function pickProcedureLabel(r: PaymentRecordRow): string | null {
  const fromAppointment = r.appointments?.procedures
  if (fromAppointment) {
    return fromAppointment.display_name ?? fromAppointment.tuss_code ?? null
  }
  const step = r.treatment_plan_steps
  if (step) {
    return step.title ?? step.procedures?.display_name ?? step.procedures?.tuss_code ?? null
  }
  return null
}
