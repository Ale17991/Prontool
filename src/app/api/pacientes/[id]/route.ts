import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPatient } from '@/lib/core/patients/get'
import { updatePatientAddress } from '@/lib/core/patients/update-address'
import { updatePatientIdentity } from '@/lib/core/patients/update-identity'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET   /api/pacientes/{id} — detalhe + sumário financeiro agregado.
 * PATCH /api/pacientes/{id} — atualiza campos mutáveis (plan_id e/ou
 *                             endereço). Admin/recepcionista apenas.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const addressPatchSchema = z
  .object({
    cep: z.string().trim().max(20).optional().nullable(),
    street: z.string().trim().max(200).optional().nullable(),
    number: z.string().trim().max(20).optional().nullable(),
    complement: z.string().trim().max(200).optional().nullable(),
    neighborhood: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().max(120).optional().nullable(),
    state: z.string().trim().max(2).optional().nullable(),
  })
  .partial()

const identityPatchSchema = z
  .object({
    sex: z.enum(['feminino', 'masculino', 'intersexo']).nullable(),
    phone: z.string().trim().max(40).nullable(),
    email: z.string().trim().email('E-mail inválido').max(200).nullable(),
    social_name: z.string().trim().max(200).nullable(),
    mother_name: z.string().trim().max(200).nullable(),
    rg: z.string().trim().max(40).nullable(),
    insurance_card_number: z.string().trim().max(60).nullable(),
    emergency_contact_name: z.string().trim().max(200).nullable(),
    emergency_contact_phone: z.string().trim().max(40).nullable(),
    guardian_name: z.string().trim().max(200).nullable(),
    guardian_cpf: z.string().trim().max(20).nullable(),
    guardian_relationship: z.string().trim().max(60).nullable(),
  })
  .partial()

const patchSchema = z
  .object({
    plan_id: z.string().uuid().nullable().optional(),
    address: addressPatchSchema.optional(),
    identity: identityPatchSchema.optional(),
    status: z.enum(['ativo', 'inativo', 'obito']).optional(),
    alert_note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine(
    (v) =>
      v.plan_id !== undefined ||
      v.address !== undefined ||
      v.identity !== undefined ||
      v.status !== undefined ||
      v.alert_note !== undefined,
    { message: 'Informe plan_id, address, identity, status ou alert_note para atualizar.' },
  )

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'patients',
        entityId: params.id,
        route: `/api/pacientes/${params.id}`,
        request: req,
      },
    )
    const supabase = createSupabaseServiceClient()
    const result = await getPatient(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route: `/api/pacientes/${params.id}` })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}`
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'patients',
      entityId: params.id,
      route,
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

    const supabase = createSupabaseServiceClient()

    if (parsed.data.plan_id !== undefined) {
      // Se plan_id foi informado (incl. null), valida e atualiza.
      if (parsed.data.plan_id) {
        const hp = await supabase
          .from('health_plans')
          .select('id')
          .eq('tenant_id', session.tenantId)
          .eq('id', parsed.data.plan_id)
          .maybeSingle()
        if (hp.error) throw new Error(`health plan lookup: ${hp.error.message}`)
        if (!hp.data) throw new NotFoundError('health_plan', parsed.data.plan_id)
      }

      const update = await supabase
        .from('patients')
        .update({ plan_id: parsed.data.plan_id })
        .eq('tenant_id', session.tenantId)
        .eq('id', params.id)
        .select('id')
        .maybeSingle()
      if (update.error) throw new Error(`patient patch: ${update.error.message}`)
      if (!update.data) throw new NotFoundError('patient', params.id)
    }

    if (parsed.data.address !== undefined) {
      await updatePatientAddress(supabase, {
        tenantId: session.tenantId,
        patientId: params.id,
        address: parsed.data.address,
      })
    }

    if (parsed.data.status !== undefined || parsed.data.alert_note !== undefined) {
      const upd: Record<string, unknown> = {}
      if (parsed.data.status !== undefined) upd.status = parsed.data.status
      if (parsed.data.alert_note !== undefined) {
        upd.alert_note = parsed.data.alert_note?.trim() || null
      }
      const r = await supabase
        .from('patients')
        .update(upd as never)
        .eq('tenant_id', session.tenantId)
        .eq('id', params.id)
        .select('id')
        .maybeSingle()
      if (r.error) throw new Error(`patient status/alert patch: ${r.error.message}`)
      if (!r.data) throw new NotFoundError('patient', params.id)
      if (parsed.data.status !== undefined) {
        await supabase.from('audit_log').insert({
          tenant_id: session.tenantId,
          actor_id: session.userId,
          actor_label: null,
          entity: 'patients',
          entity_id: params.id,
          field: 'status',
          old_value: null,
          new_value: parsed.data.status,
          reason: 'alteração de status do paciente via /api/pacientes PATCH',
          result: 'success',
        } as never)
      }
    }

    if (parsed.data.identity !== undefined) {
      const i = parsed.data.identity
      await updatePatientIdentity(supabase, {
        tenantId: session.tenantId,
        patientId: params.id,
        fields: {
          sex: i.sex,
          phone: i.phone,
          email: i.email,
          socialName: i.social_name,
          motherName: i.mother_name,
          rg: i.rg,
          insuranceCardNumber: i.insurance_card_number,
          emergencyContactName: i.emergency_contact_name,
          emergencyContactPhone: i.emergency_contact_phone,
          guardianName: i.guardian_name,
          guardianCpf: i.guardian_cpf,
          guardianRelationship: i.guardian_relationship,
        },
      })
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
