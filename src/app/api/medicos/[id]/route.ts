import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getDoctor } from '@/lib/core/doctors/get'
import { updateDoctor } from '@/lib/core/doctors/update'
import { updateDoctorPaymentMode } from '@/lib/core/doctors/update-payment-mode'
import { ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/medicos/{id} + PATCH /api/medicos/{id}.
 * - full_name e active: mutáveis.
 * - payment_mode_change (admin-only): grava nova versão em
 *   doctor_payment_terms_history via RPC `record_payment_terms_change`.
 * - CRM é imutável.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const paymentModeChangeSchema = z
  .object({
    payment_mode: z.enum(['comissionado', 'fixo', 'liberal']),
    percentage_bps: z.number().int().min(0).max(10_000).optional(),
    monthly_amount_cents: z.number().int().positive().optional(),
    billing_day: z.number().int().min(1).max(28).optional(),
    liberal_default_cents: z.number().int().positive().optional(),
    valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().min(3).max(500),
  })
  .refine(
    (v) =>
      v.payment_mode !== 'comissionado' || typeof v.percentage_bps === 'number',
    { message: 'percentage_bps obrigatório para Comissionado', path: ['percentage_bps'] },
  )
  .refine(
    (v) =>
      v.payment_mode !== 'fixo' ||
      (typeof v.monthly_amount_cents === 'number' && typeof v.billing_day === 'number'),
    { message: 'monthly_amount_cents e billing_day obrigatórios para Fixo', path: ['monthly_amount_cents'] },
  )
  .refine(
    (v) => v.payment_mode !== 'liberal' || typeof v.liberal_default_cents === 'number',
    { message: 'liberal_default_cents obrigatório para Liberal', path: ['liberal_default_cents'] },
  )

const patchSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  active: z.boolean().optional(),
  payment_mode_change: paymentModeChangeSchema.optional(),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'doctors',
        entityId: params.id,
        route: `/api/medicos/${params.id}`,
        request: req,
      },
    )
    const supabase = createSupabaseServiceClient()
    const doctor = await getDoctor(supabase, {
      tenantId: session.tenantId,
      doctorId: params.id,
    })
    return NextResponse.json(
      {
        id: doctor.id,
        full_name: doctor.fullName,
        crm: doctor.crm,
        external_identifier: doctor.externalIdentifier,
        role: doctor.role,
        specialty: doctor.specialty,
        council_name: doctor.councilName,
        council_number: doctor.councilNumber,
        active: doctor.active,
        created_at: doctor.createdAt,
        payment_mode: doctor.paymentMode,
        current_percentage_bps: doctor.currentPercentageBps,
        current_monthly_amount_cents: doctor.currentMonthlyAmountCents,
        current_billing_day: doctor.currentBillingDay,
        current_liberal_default_cents: doctor.currentLiberalDefaultCents,
        current_valid_from: doctor.currentValidFrom,
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/medicos/${params.id}` })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'doctors',
      entityId: params.id,
      route: `/api/medicos/${params.id}`,
      request: req,
    })
    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
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
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Nada para atualizar' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()

    // 1) Mudança de modalidade (admin-only, audit + nova versão em history)
    let paymentModeUpdated: 'comissionado' | 'fixo' | 'liberal' | undefined
    if (parsed.data.payment_mode_change) {
      try {
        const c = parsed.data.payment_mode_change
        const result = await updateDoctorPaymentMode(supabase, {
          tenantId: session.tenantId,
          doctorId: params.id,
          paymentMode: c.payment_mode,
          percentageBps: c.percentage_bps ?? null,
          monthlyAmountCents: c.monthly_amount_cents ?? null,
          billingDay: c.billing_day ?? null,
          liberalDefaultCents: c.liberal_default_cents ?? null,
          validFrom: c.valid_from,
          reason: c.reason,
          actorUserId: session.userId,
        })
        paymentModeUpdated = result.paymentMode
      } catch (err) {
        if (err instanceof ValidationError) {
          return NextResponse.json(
            { error: { code: err.code, message: err.message, meta: err.meta } },
            { status: 400 },
          )
        }
        throw err
      }
    }

    // 2) Demais campos via updateDoctor
    let basicUpdated: { id: string; fullName: string; active: boolean } | null = null
    if (parsed.data.full_name !== undefined || parsed.data.active !== undefined) {
      basicUpdated = await updateDoctor(supabase, {
        tenantId: session.tenantId,
        doctorId: params.id,
        patch: {
          ...(parsed.data.full_name !== undefined ? { fullName: parsed.data.full_name } : {}),
          ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        },
      })
    }

    return NextResponse.json(
      {
        id: params.id,
        ...(basicUpdated
          ? { full_name: basicUpdated.fullName, active: basicUpdated.active }
          : {}),
        ...(paymentModeUpdated ? { payment_mode: paymentModeUpdated } : {}),
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/medicos/${params.id}` })
  }
}
