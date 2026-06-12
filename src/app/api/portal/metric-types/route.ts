/**
 * Feature 030/0123 — /api/portal/metric-types (equipe).
 *
 * GET:  lista as métricas que a clínica enxerga (globais + custom dela).
 * POST: cadastra uma métrica PERSONALIZADA da clínica — só admin. A métrica
 *       passa a aparecer na entrada de medições da equipe e no portal do
 *       paciente (sujeita ao liga/desliga de /configuracoes/portal-paciente).
 *
 * Escopo sempre o tenant da sessão; o catálogo global (seed) não é alterado.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import {
  createCustomMetricType,
  listEnabledMetricTypesForTenant,
} from '@/lib/core/patient-portal/metric-types'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
  label: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(16),
  min_plausible: z.number().finite(),
  max_plausible: z.number().finite(),
  specialty: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,31}$/)
    .optional(),
  display_order: z.number().int().min(0).max(9999).optional(),
})

export async function GET(req: Request): Promise<Response> {
  const route = '/api/portal/metric-types'
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'patient_metric_types', route, request: req },
    )
    const supabase = createSupabaseServiceClient()
    const metricTypes = await listEnabledMetricTypesForTenant(supabase, session.tenantId)
    return NextResponse.json({ metricTypes }, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request): Promise<Response> {
  const route = '/api/portal/metric-types'
  try {
    const session = await requireRole(['admin'], {
      entity: 'patient_metric_types',
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
    const metricType = await createCustomMetricType(supabase, {
      tenantId: session.tenantId,
      label: parsed.data.label,
      unit: parsed.data.unit,
      minPlausible: parsed.data.min_plausible,
      maxPlausible: parsed.data.max_plausible,
      specialty: parsed.data.specialty,
      displayOrder: parsed.data.display_order,
    })
    return NextResponse.json(metricType, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
