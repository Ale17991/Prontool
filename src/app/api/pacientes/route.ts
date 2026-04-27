import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPatients } from '@/lib/core/patients/list'
import { createPatientManually } from '@/lib/core/patients/create-manual'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET  /api/pacientes — lista paginada com busca por nome/CPF.
 *                       Permissão: qualquer papel autenticado dentro do tenant.
 * POST /api/pacientes — cria paciente manualmente (PII criptografada local,
 *                       melhor esforço de sincronização com GHL).
 *                       Permissão: admin ou recepcionista.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  q: z.string().optional(),
  page: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v))),
  page_size: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v))),
})

// CPF: 11 dígitos, aceita com ou sem pontuação; normalizamos no handler.
const cpfDigits = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 11, 'CPF deve ter 11 dígitos')

const addressSchema = z
  .object({
    cep: z.string().trim().max(20).optional().nullable(),
    street: z.string().trim().max(200).optional().nullable(),
    number: z.string().trim().max(20).optional().nullable(),
    complement: z.string().trim().max(200).optional().nullable(),
    neighborhood: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().max(120).optional().nullable(),
    state: z.string().trim().max(2).optional().nullable(),
  })
  .optional()
  .nullable()

const createSchema = z.object({
  full_name: z.string().trim().min(2).max(200),
  cpf: cpfDigits,
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable(),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO AAAA-MM-DD')
    .optional()
    .nullable(),
  // Obrigatório na UI mas nullable no backend pra não quebrar dados
  // legados; a UI manda sempre que puder.
  plan_id: z.string().uuid().optional().nullable(),
  address: addressSchema,
})

export async function GET(req: Request): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'patients', route: '/api/pacientes', request: req },
    )
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Filtros inválidos' } },
        { status: 400 },
      )
    }
    const supabase = createSupabaseServiceClient()
    const result = await listPatients(supabase, {
      tenantId: session.tenantId,
      search: parsed.data.q,
      page: parsed.data.page,
      pageSize: parsed.data.page_size,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/pacientes' })
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'patients',
      route: '/api/pacientes',
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
    const result = await createPatientManually(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      fullName: parsed.data.full_name,
      cpf: parsed.data.cpf,
      phone: parsed.data.phone ?? undefined,
      email: parsed.data.email ?? undefined,
      birthDate: parsed.data.birth_date ?? undefined,
      planId: parsed.data.plan_id ?? null,
      address: parsed.data.address ?? undefined,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/pacientes' })
  }
}
