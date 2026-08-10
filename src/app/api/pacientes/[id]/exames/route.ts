/**
 * Feature 050 US1 — /api/pacientes/[id]/exames (equipe).
 *
 * GET: resultados laboratoriais do paciente já classificados (baixo/normal/alto)
 * contra a faixa de referência do seu sexo/idade, mais a série histórica por
 * analito para o gráfico de evolução.
 * POST: lança um laudo (N resultados com a mesma data), atomicamente.
 *
 * Gated `exames_lab`; RBAC admin/profissional_saude. Os resultados moram em
 * `patient_measurements` (motor da 030) — append-only: relançar o mesmo analito
 * na mesma data cria um registro novo (correção), não sobrescreve.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { recordMeasurementsBatch } from '@/lib/core/patient-portal/measurements'
import { LAB_ANALYTES } from '@/lib/core/labs/catalog'
import { buildLabPanelForPatient, labOverridesFromUrl } from '@/lib/core/labs/panel-for-patient'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ANALYTE_KEYS = new Set(LAB_ANALYTES.map((a) => a.key))

const saveSchema = z.object({
  measured_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(300).optional().nullable(),
  results: z
    .array(
      z.object({
        analyte_key: z.string().refine((k) => ANALYTE_KEYS.has(k), 'analito fora do catálogo'),
        value: z.number().finite(),
      }),
    )
    .min(1)
    .max(60),
})

async function gate(tenantId: string): Promise<boolean> {
  const ent = await getTenantEntitlements(createSupabaseServiceClient(), tenantId)
  return ent.hasModule('exames_lab')
}
function moduleDisabled(): Response {
  return NextResponse.json(
    { error: { code: 'MODULE_DISABLED', message: 'Módulo indisponível.' } },
    { status: 404 },
  )
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/exames`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_measurements',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()
    const supabase = createSupabaseServiceClient()
    const payload = await buildLabPanelForPatient(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      overrides: labOverridesFromUrl(new URL(req.url)),
    })
    return NextResponse.json(payload, { status: 200 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const route = `/api/pacientes/${params.id}/exames`
  try {
    const session = await requireRole(['admin', 'profissional_saude'], {
      entity: 'patient_measurements',
      entityId: params.id,
      route,
      request: req,
    })
    if (!(await gate(session.tenantId))) return moduleDisabled()

    const parsed = saveSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const b = parsed.data

    const supabase = createSupabaseServiceClient()
    // Atômico: valida TODAS as entradas antes de inserir. Um valor fora da
    // faixa plausível rejeita o laudo inteiro (nada é gravado).
    const { measurements } = await recordMeasurementsBatch(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      measuredAt: b.measured_at,
      notes: b.notes ?? null,
      actorUserId: session.userId,
      entries: b.results.map((r) => ({ metricType: r.analyte_key, value: r.value })),
    })

    const payload = await buildLabPanelForPatient(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      overrides: labOverridesFromUrl(new URL(req.url)),
    })
    return NextResponse.json({ recorded: measurements.length, ...payload }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
