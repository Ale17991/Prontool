import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { createVitalSigns, listVitalSigns } from '@/lib/core/patient-medical/vital-signs'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  measured_at: z.string().optional().nullable(),
  systolic_bp: z.number().int().min(40).max(300).optional().nullable(),
  diastolic_bp: z.number().int().min(20).max(200).optional().nullable(),
  heart_rate: z.number().int().min(20).max(300).optional().nullable(),
  respiratory_rate: z.number().int().min(5).max(80).optional().nullable(),
  temperature_celsius: z.number().min(25).max(45).optional().nullable(),
  oxygen_saturation: z.number().int().min(50).max(100).optional().nullable(),
  weight_grams: z.number().int().min(500).max(500_000).optional().nullable(),
  height_cm: z.number().int().min(30).max(260).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  appointment_id: z.string().uuid().optional().nullable(),
})

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/sinais-vitais`
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'vital_signs', entityId: params.id, route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const items = await listVitalSigns(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
    })
    return NextResponse.json(items, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const route = `/api/pacientes/${params.id}/sinais-vitais`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'vital_signs',
      entityId: params.id,
      route,
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
    const result = await createVitalSigns(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      actorUserId: session.userId,
      measuredAt: parsed.data.measured_at ?? undefined,
      systolicBp: parsed.data.systolic_bp ?? null,
      diastolicBp: parsed.data.diastolic_bp ?? null,
      heartRate: parsed.data.heart_rate ?? null,
      respiratoryRate: parsed.data.respiratory_rate ?? null,
      temperatureCelsius: parsed.data.temperature_celsius ?? null,
      oxygenSaturation: parsed.data.oxygen_saturation ?? null,
      weightGrams: parsed.data.weight_grams ?? null,
      heightCm: parsed.data.height_cm ?? null,
      notes: parsed.data.notes ?? null,
      appointmentId: parsed.data.appointment_id ?? null,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
