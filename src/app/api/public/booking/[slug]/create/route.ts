/**
 * Feature 017 — POST /api/public/booking/[slug]/create
 *
 * Rota PÚBLICA (sem auth). Cria appointment a partir do form do paciente.
 *
 * Versão US1 (Phase 4): SEM Turnstile e SEM rate limit. Esses entram na
 * Phase 5 (US3) com testes de contrato.
 *
 * Resposta: 201 com { appointmentId, cancelToken, redirectUrl, ... } ou
 * códigos de erro estruturados conforme api-create-booking.contract.md.
 */

import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createPublicBooking } from '@/lib/core/public-booking/create-booking'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,31}$/)

const BodySchema = z.object({
  doctor_id: z.string().uuid(),
  procedure_id: z.string().uuid(),
  slot_start: z.string().datetime({ offset: true }),
  patient: z.object({
    full_name: z.string().min(3).max(120),
    cpf: z
      .string()
      .regex(/^\d{11}$/)
      .optional(),
    email: z.string().email().max(120),
    phone: z.string().min(8).max(20),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  lgpd_consent: z.literal(true),
  turnstile_token: z.string().min(1).max(2048).optional(),
})

function extractIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

function hashIp(ip: string, slug: string): string {
  return createHash('sha256').update(`${ip}:${slug}`).digest('hex')
}

export async function POST(
  request: NextRequest,
  context: { params: { slug: string } },
) {
  const slugCheck = SlugSchema.safeParse(context.params.slug)
  if (!slugCheck.success) {
    return NextResponse.json(
      { error: 'TENANT_NOT_FOUND_OR_DISABLED' },
      { status: 404 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'INVALID_PAYLOAD', message: 'JSON malformed' },
      { status: 400 },
    )
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'INVALID_PAYLOAD',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const ip = extractIp(request)
  const ipHash = hashIp(ip, slugCheck.data)
  const ua = request.headers.get('user-agent')

  const supabase = createSupabaseServiceClient()

  const result = await createPublicBooking(supabase, {
    slug: slugCheck.data,
    doctorId: parsed.data.doctor_id,
    procedureId: parsed.data.procedure_id,
    slotStart: parsed.data.slot_start,
    patient: {
      fullName: parsed.data.patient.full_name,
      cpf: parsed.data.patient.cpf,
      email: parsed.data.patient.email,
      phone: parsed.data.patient.phone,
      birthDate: parsed.data.patient.birth_date,
    },
    lgpdConsent: true,
    turnstileToken: parsed.data.turnstile_token ?? '',
    ipHash,
    userAgent: ua,
  })

  if (!result.ok) {
    switch (result.error) {
      case 'TENANT_NOT_FOUND_OR_DISABLED':
        return NextResponse.json({ error: result.error }, { status: 404 })
      case 'DOCTOR_PROCEDURE_NOT_PUBLISHED':
      case 'INVALID_SLOT_START':
      case 'OUT_OF_BOOKING_WINDOW':
        return NextResponse.json(
          { error: 'VALIDATION_FAILED', code: result.error, message: result.message },
          { status: 422 },
        )
      case 'SLOT_NO_LONGER_AVAILABLE':
        return NextResponse.json(
          {
            error: result.error,
            message: 'Esse horário acabou de ser ocupado. Por favor, escolha outro.',
          },
          { status: 409 },
        )
      default:
        return NextResponse.json(
          { error: 'INTERNAL_ERROR' },
          { status: 500 },
        )
    }
  }

  return NextResponse.json(result.data, { status: 201 })
}
