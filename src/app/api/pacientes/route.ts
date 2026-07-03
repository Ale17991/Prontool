import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPatients } from '@/lib/core/patients/list'
import { createPatientManually } from '@/lib/core/patients/create-manual'
import { listTagsForPatients } from '@/lib/core/patient-tags/service'
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
  // Quando 'plan', enriquece cada item com planId e planName via batch
  // select em patients/health_plans. Usado pelo typeahead de paciente.
  // 'tags' acrescenta as tags atribuídas a cada paciente.
  // Múltiplos valores separados por vírgula: include=plan,tags
  include: z
    .string()
    .optional()
    .transform(
      (v) =>
        (v ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as Array<'plan' | 'tags'>,
    ),
})

// CPF: opcional no backend (GHL/legado podem não ter). A obrigatoriedade é
// imposta no formulário de cadastro manual. Se preenchido, exige 11 dígitos.
const cpfOptional = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null
    const digits = v.replace(/\D/g, '')
    return digits.length === 0 ? null : digits
  })
  .refine((s) => s === null || s.length === 11, 'CPF deve ter 11 dígitos quando preenchido.')

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

// Campo de texto opcional: trim + '' vira null. Reutilizado nos novos campos
// de identificação clínica.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null))

const createSchema = z.object({
  full_name: z.string().trim().min(2).max(200),
  // Memed exige CPF/celular/e-mail/nascimento — a obrigatoriedade é imposta no
  // formulário de cadastro (cliente). Backend permanece tolerante p/ GHL/legado.
  cpf: cpfOptional,
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
  // Identificação clínica (todos opcionais).
  sex: z.enum(['feminino', 'masculino', 'intersexo']).optional().nullable(),
  social_name: optionalText(200),
  mother_name: optionalText(200),
  rg: optionalText(40),
  insurance_card_number: optionalText(60),
  emergency_contact_name: optionalText(200),
  emergency_contact_phone: optionalText(40),
  guardian_name: optionalText(200),
  guardian_cpf: optionalText(20),
  guardian_relationship: optionalText(60),
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

    const includes = new Set(parsed.data.include)
    const wantPlan = includes.has('plan')
    const wantTags = includes.has('tags')

    if ((wantPlan || wantTags) && result.items.length > 0) {
      const ids = result.items.map((p) => p.id)
      const planById = new Map<string, { planId: string | null; planName: string | null }>()
      if (wantPlan) {
        // Batch lookup de plano (plan_id + nome) — não vem do RPC porque
        // plan_id não é PII e fica em coluna em claro de `patients`.
        const { data: rows } = await supabase
          .from('patients')
          .select('id, plan_id, health_plans:plan_id ( id, name )')
          .eq('tenant_id', session.tenantId)
          .in('id', ids)
        for (const row of (rows ?? []) as Array<{
          id: string
          plan_id: string | null
          health_plans: { id: string; name: string } | null
        }>) {
          planById.set(row.id, {
            planId: row.plan_id,
            planName: row.health_plans?.name ?? null,
          })
        }
      }

      const tagsById = wantTags
        ? await listTagsForPatients(supabase, {
            tenantId: session.tenantId,
            patientIds: ids,
          })
        : new Map()

      const enriched = {
        ...result,
        items: result.items.map((p) => ({
          ...p,
          ...(wantPlan
            ? {
                planId: planById.get(p.id)?.planId ?? null,
                planName: planById.get(p.id)?.planName ?? null,
              }
            : {}),
          ...(wantTags ? { tags: tagsById.get(p.id) ?? [] } : {}),
        })),
      }
      return NextResponse.json(enriched, { status: 200 })
    }

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
      sex: parsed.data.sex ?? null,
      socialName: parsed.data.social_name,
      motherName: parsed.data.mother_name,
      rg: parsed.data.rg,
      insuranceCardNumber: parsed.data.insurance_card_number,
      emergencyContactName: parsed.data.emergency_contact_name,
      emergencyContactPhone: parsed.data.emergency_contact_phone,
      guardianName: parsed.data.guardian_name,
      guardianCpf: parsed.data.guardian_cpf,
      guardianRelationship: parsed.data.guardian_relationship,
      address: parsed.data.address ?? undefined,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route: '/api/pacientes' })
  }
}
