import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createAppointmentManually } from '@/lib/core/appointments/create-manual'
import { publishDomainEvent } from '@/lib/core/events/publish'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * POST /api/atendimentos/manual — Registro manual de atendimento (US1).
 *
 * Independente de webhook. `source='manual'` no banco. Após o INSERT,
 * publica `appointment.created` no event bus — que é noop em modo
 * standalone (zero integrações habilitadas) e fan-out para adapters em
 * modo conectado (US3).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  procedure_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  appointment_at: z.string().datetime(),
  amount_cents_override: z.number().int().min(0).optional(),
  observacoes: z.string().trim().max(500).optional(),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'recepcionista'], {
      entity: 'appointments',
      route: '/api/atendimentos/manual',
      request: req,
    })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
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
    const result = await createAppointmentManually(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      patientId: parsed.data.patient_id,
      doctorId: parsed.data.doctor_id,
      procedureId: parsed.data.procedure_id,
      planId: parsed.data.plan_id,
      appointmentAt: parsed.data.appointment_at,
      amountCentsOverride: parsed.data.amount_cents_override,
      observacoes: parsed.data.observacoes,
    })

    // Build snapshots for the event bus. Patient/appointment detail is
    // adapter-visible; PII fields stay masked for standalone path that
    // never invokes an adapter.
    const patient = await supabase
      .from('patients')
      .select('id, tenant_id, plan_id, ghl_contact_id')
      .eq('id', parsed.data.patient_id)
      .single()

    const integrationsDispatched = await publishDomainEvent(supabase, session.tenantId, {
      type: 'appointment.created',
      appointment: {
        id: result.appointmentId,
        tenantId: session.tenantId,
        patientId: parsed.data.patient_id,
        doctorId: parsed.data.doctor_id,
        procedureId: parsed.data.procedure_id,
        procedureTussCode: '',
        planId: parsed.data.plan_id,
        appointmentAt: parsed.data.appointment_at,
        frozenAmountCents: result.frozenAmountCents,
        source: 'manual',
      },
      patient: {
        id: patient.data?.id ?? parsed.data.patient_id,
        tenantId: session.tenantId,
        fullName: '',
        cpf: '',
        email: null,
        phone: null,
        birthDate: null,
        planId: patient.data?.plan_id ?? null,
        ghlContactId: patient.data?.ghl_contact_id ?? null,
      },
    })

    return NextResponse.json(
      {
        appointment_id: result.appointmentId,
        source: 'manual',
        frozen_amount_cents: result.frozenAmountCents,
        frozen_commission_bps: result.frozenCommissionBps,
        appointment_at: parsed.data.appointment_at,
        integrations_dispatched: integrationsDispatched,
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: '/api/atendimentos/manual' })
  }
}
