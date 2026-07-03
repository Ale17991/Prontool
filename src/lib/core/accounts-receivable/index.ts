import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export type ReceivableStatus = 'pendente' | 'atrasado' | 'parcial' | 'inadimplencia'

export interface ReceivableRow {
  installmentId: string
  paymentRecordId: string
  patientId: string | null
  patientName: string | null
  patientIsAnonymized: boolean
  planName: string | null
  installmentNumber: number
  amountCents: number
  paidAmountCents: number
  pendingAmountCents: number
  dueDate: string
  status: ReceivableStatus
  daysOverdue: number
  paymentsCount: number
}

export interface ReceivableFilters {
  tenantId: string
  from?: string | null
  to?: string | null
  status?: ReceivableStatus | 'all'
  planId?: string | null
  patientId?: string | null
  limit?: number
}

export interface ReceivableSummary {
  totalPendingCents: number
  countOverdue: number
  countCritical: number
}

interface DbRow {
  id: string
  payment_record_id: string
  installment_number: number
  amount_cents: number
  paid_amount_cents: number
  due_date: string
  status: string
  payment_records: {
    patient_id: string | null
    patients: {
      ghl_contact_id: string
      anonymized_at: string | null
    } | null
  } | null
}

const CRITICAL_OVERDUE_DAYS = 60

function diffDaysFromToday(due: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(due + 'T00:00:00')
  return Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

export async function listReceivables(
  supabase: SupabaseClient<Database>,
  filters: ReceivableFilters,
): Promise<{ rows: ReceivableRow[]; summary: ReceivableSummary }> {
  let q = supabase
    .from('payment_installments' as never)
    .select(
      'id, payment_record_id, installment_number, amount_cents, paid_amount_cents, due_date, status, payment_records!inner(patient_id, patients(ghl_contact_id, anonymized_at))',
    )
    .eq('tenant_id', filters.tenantId)
    .order('due_date', { ascending: true })
    .limit(Math.min(filters.limit ?? 100, 500))

  if (filters.status && filters.status !== 'all') {
    q = q.eq('status', filters.status)
  } else {
    q = q.in('status', ['pendente', 'atrasado', 'parcial', 'inadimplencia'])
  }
  if (filters.from) q = q.gte('due_date', filters.from)
  if (filters.to) q = q.lte('due_date', filters.to)

  const { data, error } = await q
  if (error) throw new Error(`list receivables: ${error.message}`)

  const rawRows = (data ?? []) as unknown as DbRow[]

  // Buscar contagem de pagamentos por parcela (1 query agregada)
  const installmentIds = rawRows.map((r) => r.id)
  const countsMap = new Map<string, number>()
  if (installmentIds.length > 0) {
    const cnt = await supabase
      .from('installment_payments' as never)
      .select('installment_id')
      .in('installment_id', installmentIds)
    if (!cnt.error && cnt.data) {
      for (const r of cnt.data as unknown as Array<{ installment_id: string }>) {
        countsMap.set(r.installment_id, (countsMap.get(r.installment_id) ?? 0) + 1)
      }
    }
  }

  const rows: ReceivableRow[] = rawRows.map((r) => {
    const amount = Number(r.amount_cents)
    const paid = Number(r.paid_amount_cents)
    const pending = amount - paid
    const days = diffDaysFromToday(r.due_date)
    const isAnonymized =
      r.payment_records?.patients?.anonymized_at !== null &&
      r.payment_records?.patients?.anonymized_at !== undefined
    return {
      installmentId: r.id,
      paymentRecordId: r.payment_record_id,
      patientId: r.payment_records?.patient_id ?? null,
      patientName: null,
      patientIsAnonymized: isAnonymized,
      planName: null,
      installmentNumber: r.installment_number,
      amountCents: amount,
      paidAmountCents: paid,
      pendingAmountCents: pending,
      dueDate: r.due_date,
      status: r.status as ReceivableStatus,
      daysOverdue: days > 0 ? days : 0,
      paymentsCount: countsMap.get(r.id) ?? 0,
    }
  })

  const summary: ReceivableSummary = {
    totalPendingCents: rows.reduce((s, r) => s + r.pendingAmountCents, 0),
    countOverdue: rows.filter((r) => r.daysOverdue > 0).length,
    countCritical: rows.filter((r) => r.daysOverdue > CRITICAL_OVERDUE_DAYS).length,
  }

  return { rows, summary }
}

export async function markInstallmentAsBadDebt(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    installmentId: string
    actorUserId: string
    reason?: string
  },
): Promise<void> {
  const upd = await supabase
    .from('payment_installments' as never)
    .update({ status: 'inadimplencia' } as never)
    .eq('id', args.installmentId)
    .eq('tenant_id', args.tenantId)
  if (upd.error) throw new Error(`mark bad debt: ${upd.error.message}`)
  await supabase.rpc(
    'log_audit_event' as never,
    {
      p_tenant_id: args.tenantId,
      p_entity: 'payment_installments',
      p_entity_id: args.installmentId,
      p_field: 'status',
      p_old: null,
      p_new: 'inadimplencia',
      p_reason: args.reason ?? 'admin/financeiro marcou como inadimplência',
    } as never,
  )
}
