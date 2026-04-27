import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createPaymentRecord, type PaymentMethod } from '@/lib/core/payments/create'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const methodEnum = z.enum([
  'dinheiro',
  'pix',
  'cartao_credito',
  'cartao_debito',
  'boleto',
  'convenio',
  'outro',
])

const installmentSchema = z.object({
  installment_number: z.number().int().min(1).optional(),
  amount_cents: z.number().int().min(0),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO AAAA-MM-DD'),
})

const createSchema = z.object({
  patient_id: z.string().uuid(),
  appointment_id: z.string().uuid().optional().nullable(),
  treatment_step_id: z.string().uuid().optional().nullable(),
  total_amount_cents: z.number().int().min(0),
  payment_method: methodEnum,
  installments: z.array(installmentSchema).optional(),
  installments_count: z.number().int().min(1).max(60).optional(),
  initial_status: z.enum(['pendente', 'pago']).optional(),
  paid_at: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'financeiro'], {
      entity: 'payment_records',
      route: '/api/pagamentos',
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Payload inválido',
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await createPaymentRecord(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      patientId: parsed.data.patient_id,
      appointmentId: parsed.data.appointment_id ?? null,
      treatmentStepId: parsed.data.treatment_step_id ?? null,
      totalAmountCents: parsed.data.total_amount_cents,
      paymentMethod: parsed.data.payment_method as PaymentMethod,
      installments: parsed.data.installments?.map((i) => ({
        installmentNumber: i.installment_number,
        amountCents: i.amount_cents,
        dueDate: i.due_date,
      })),
      installmentsCount: parsed.data.installments_count,
      initialStatus: parsed.data.initial_status,
      paidAt: parsed.data.paid_at ?? null,
      notes: parsed.data.notes ?? null,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/pagamentos' })
  }
}
