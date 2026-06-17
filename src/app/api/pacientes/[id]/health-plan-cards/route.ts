import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPatientCard, upsertPatientCard } from '@/lib/core/tiss/patient-cards'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * Feature 029 (US2) — carteira do beneficiário por operadora.
 *   GET  ?health_plan_id=…  → status MASCARADO (não devolve o número em claro).
 *   POST { health_plan_id, card_number, card_valid_until? } → upsert (cifra).
 *
 * O número completo só é decifrado server-side ao montar a guia. Aqui a UI
 * de cadastro vê apenas se há carteira + os últimos dígitos + validade.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROLES = ['admin', 'recepcionista', 'financeiro'] as const

const querySchema = z.object({
  health_plan_id: z.string().uuid(),
})

const bodySchema = z.object({
  health_plan_id: z.string().uuid(),
  card_number: z.string().trim().min(1, 'Número da carteira obrigatório').max(40),
  card_valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Validade deve ser YYYY-MM-DD')
    .nullable()
    .optional(),
})

function maskCard(card: string): string {
  const trimmed = card.trim()
  if (trimmed.length <= 4) return '•'.repeat(trimmed.length)
  return `•••• ${trimmed.slice(-4)}`
}

function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/health-plan-cards`
  try {
    const session = await requireRole(ROLES, {
      entity: 'patient_health_plan_cards',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'health_plan_id (UUID) obrigatório' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const card = await getPatientCard(
      supabase,
      session.tenantId,
      params.id,
      parsed.data.health_plan_id,
    )
    return NextResponse.json(
      card
        ? {
            hasCard: true,
            cardNumberMasked: maskCard(card.cardNumber),
            cardValidUntil: card.cardValidUntil,
          }
        : { hasCard: false, cardNumberMasked: null, cardValidUntil: null },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/health-plan-cards`
  try {
    const session = await requireRole(ROLES, {
      entity: 'patient_health_plan_cards',
      entityId: params.id,
      route,
      request: req,
    })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Dados inválidos.',
            fields: parsed.error.issues.map((i) => ({
              field: i.path.join('.'),
              message: i.message,
            })),
          },
        },
        { status: 422 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await upsertPatientCard({
      supabase,
      tenantId: session.tenantId,
      patientId: params.id,
      healthPlanId: parsed.data.health_plan_id,
      cardNumber: parsed.data.card_number,
      cardValidUntil: parsed.data.card_valid_until ?? null,
      actorUserId: session.userId,
      actorLabel: session.email ? `user:${session.email}` : `user:${session.userId}`,
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json({ id: result.id }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
