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
 * Aceita N procedimentos por atendimento (multi-linha). Cada linha pode
 * ter seu proprio plano (ou ser particular). Total congelado = soma das
 * linhas. Comissao continua doctor-centric (uma taxa para o atendimento
 * inteiro).
 *
 * Apos o INSERT, publica `appointment.created` no event bus. Para
 * adapters externos (GHL outbound), expoe o procedimento da linha primaria
 * — adapters single-procedure continuam funcionando, e o consumidor
 * que quiser ver todas as linhas le diretamente de appointment_procedures.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const materialItemSchema = z.object({
  tuss_code: z.string().min(1).max(20),
  tuss_description: z.string().min(1).max(500),
  quantity: z.number().int().positive().default(1),
})

const procedureLineSchema = z.object({
  procedure_id: z.string().uuid(),
  /** null = linha particular nesta linha (independente do plano do atendimento). */
  plan_id: z.string().uuid().nullable(),
  /** Quando ausente, usa preco vigente do (procedure, plan) ou default_amount_cents (particular). */
  amount_cents_override: z.number().int().min(0).optional(),
  /** Observação opcional por linha (até 500 chars). Migration 0077. */
  notes: z.string().trim().max(500).optional().nullable(),
})

const bodySchema = z.object({
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  procedures: z.array(procedureLineSchema).min(1).max(20),
  appointment_at: z.string().datetime(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  observacoes: z.string().trim().max(500).optional(),
  /** Materiais opcionais (TUSS tabela 19). Feature 007. */
  materiais: z.array(materialItemSchema).max(50).optional(),
  /** Quando true (default), garante uma etapa de tratamento vinculada. */
  add_to_treatment_plan: z.boolean().optional(),
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
    const materialsInput = parsed.data.materiais
      ? parsed.data.materiais.map((m) => ({
          tussCode: m.tuss_code,
          tussDescription: m.tuss_description,
          quantity: m.quantity,
        }))
      : undefined

    const result = await createAppointmentManually(supabase, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      patientId: parsed.data.patient_id,
      doctorId: parsed.data.doctor_id,
      procedures: parsed.data.procedures.map((p) => ({
        procedureId: p.procedure_id,
        planId: p.plan_id,
        amountCentsOverride: p.amount_cents_override,
        notes: p.notes ?? null,
      })),
      appointmentAt: parsed.data.appointment_at,
      durationMinutes: parsed.data.duration_minutes,
      observacoes: parsed.data.observacoes,
      materials: materialsInput,
      addToTreatmentPlan: parsed.data.add_to_treatment_plan,
    })

    // Snapshot da linha primaria para event bus (single-procedure adapters).
    const primary = result.lines[0]!

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
        procedureId: primary.procedureId,
        procedureTussCode: '',
        planId: primary.planId,
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
        procedures_count: result.proceduresCount,
        integrations_dispatched: integrationsDispatched,
        ...(result.materialsCount !== undefined ? { materials_count: result.materialsCount } : {}),
      },
      { status: 201 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: '/api/atendimentos/manual' })
  }
}
