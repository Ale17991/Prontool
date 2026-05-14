import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listDoctors } from '@/lib/core/doctors/list'
import { createDoctor } from '@/lib/core/doctors/create'
import { ConflictError, ValidationError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * T126 — GET /api/medicos + POST /api/medicos. Leitura para todos os
 * papéis com `doctor.read`; POST admin-only (RLS `doctors_admin_insert`
 * + `commission_admin_insert` exigem role=admin de qualquer forma).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  include_inactive: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
})

// Feature 013 — schema com modalidade + refine cruzado por modalidade.
// Backward-compat: clients legados que não enviam `payment_mode` caem
// em 'comissionado' e devem continuar passando `initial_percentage_bps`.
const createSchema = z
  .object({
    full_name: z.string().min(1).max(200),
    crm: z.string().min(1).max(50),
    external_identifier: z.string().max(120).nullable().optional(),
    role: z.string().max(50).nullable().optional(),
    specialty: z.string().max(120).nullable().optional(),
    council_name: z.string().max(20).nullable().optional(),
    council_number: z.string().max(50).nullable().optional(),
    payment_mode: z.enum(['comissionado', 'fixo', 'liberal']).default('comissionado'),
    initial_percentage_bps: z.number().int().min(0).max(10_000).optional(),
    monthly_amount_cents: z.number().int().positive().optional(),
    billing_day: z.number().int().min(1).max(28).optional(),
    liberal_default_cents: z.number().int().positive().optional(),
    initial_valid_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
    initial_reason: z.string().min(3).max(500),
  })
  .refine(
    (v) =>
      v.payment_mode !== 'comissionado' || typeof v.initial_percentage_bps === 'number',
    { message: 'initial_percentage_bps obrigatório para modalidade Comissionado', path: ['initial_percentage_bps'] },
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

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'doctors', route: '/api/medicos', request: req },
    )
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const list = await listDoctors(supabase, {
      tenantId: session.tenantId,
      includeInactive: parsed.data.include_inactive,
    })
    return NextResponse.json(list, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/medicos' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin'], {
      entity: 'doctors',
      route: '/api/medicos',
      request: req,
    })
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    try {
      const created = await createDoctor(supabase, {
        tenantId: session.tenantId,
        fullName: parsed.data.full_name,
        crm: parsed.data.crm,
        externalIdentifier: parsed.data.external_identifier ?? null,
        role: parsed.data.role ?? null,
        specialty: parsed.data.specialty ?? null,
        councilName: parsed.data.council_name ?? null,
        councilNumber: parsed.data.council_number ?? null,
        paymentMode: parsed.data.payment_mode,
        initialPercentageBps: parsed.data.initial_percentage_bps ?? null,
        monthlyAmountCents: parsed.data.monthly_amount_cents ?? null,
        billingDay: parsed.data.billing_day ?? null,
        liberalDefaultCents: parsed.data.liberal_default_cents ?? null,
        initialValidFrom: parsed.data.initial_valid_from,
        initialReason: parsed.data.initial_reason,
        actorUserId: session.userId,
      })
      return NextResponse.json(
        {
          id: created.id,
          full_name: created.fullName,
          crm: created.crm,
          external_identifier: created.externalIdentifier,
          role: created.role,
          specialty: created.specialty,
          council_name: created.councilName,
          council_number: created.councilNumber,
          active: created.active,
          created_at: created.createdAt,
          payment_mode: created.paymentMode,
          current_percentage_bps: created.currentPercentageBps,
          current_monthly_amount_cents: created.currentMonthlyAmountCents,
          current_billing_day: created.currentBillingDay,
          current_liberal_default_cents: created.currentLiberalDefaultCents,
          current_valid_from: created.currentValidFrom,
        },
        { status: 201 },
      )
    } catch (err) {
      if (err instanceof ConflictError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, meta: err.meta } },
          { status: 409 },
        )
      }
      if (err instanceof ValidationError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, meta: err.meta } },
          { status: 400 },
        )
      }
      throw err
    }
  } catch (err) {
    return toHttpResponse(err, { route: '/api/medicos' })
  }
}
