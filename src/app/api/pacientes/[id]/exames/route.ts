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
import { listMeasurements, recordMeasurementsBatch } from '@/lib/core/patient-portal/measurements'
import { isLabAnalyte, LAB_ANALYTES } from '@/lib/core/labs/catalog'
import { classifyLabResults, type LabResultInput } from '@/lib/core/labs/classify'
import {
  listLabRangesForPatient,
  listSexDependentAnalytes,
  type LabSex,
  type LabState,
} from '@/lib/core/labs/reference-ranges'
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

function ageFromBirth(iso: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let a = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
  return a >= 0 && a < 130 ? a : null
}

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>

/**
 * Monta o payload de leitura. Quando falta sexo ou idade, devolve os resultados
 * mesmo assim com `panel: null` e `need` — a tela pede o dado que falta em vez
 * de bloquear o registro (FR-006). Mesmo comportamento de `/adequacao` (049).
 */
async function buildPayload(
  supabase: ServiceClient,
  args: { tenantId: string; patientId: string; url: URL },
) {
  const byMetric = await listMeasurements(supabase, {
    tenantId: args.tenantId,
    patientId: args.patientId,
  })

  const results: LabResultInput[] = []
  const series: Record<string, Array<{ measuredAt: string; value: number }>> = {}
  for (const [metricType, list] of Object.entries(byMetric)) {
    if (!isLabAnalyte(metricType)) continue
    series[metricType] = list.map((m) => ({ measuredAt: m.measuredAt, value: m.value }))
    for (const m of list) {
      results.push({
        analyteKey: metricType,
        value: m.value,
        unit: m.unit,
        measuredAt: m.measuredAt,
      })
    }
  }

  // Query param sobrescreve o cadastro (a tela permite ajustar sem bloquear).
  const rawAge = args.url.searchParams.get('age')
  let ageYears = rawAge !== null && rawAge !== '' ? Number(rawAge) : null
  if (ageYears !== null && !Number.isFinite(ageYears)) ageYears = null
  let sex = args.url.searchParams.get('sex') as LabSex | null
  if (sex !== 'M' && sex !== 'F') sex = null
  const stateParam = args.url.searchParams.get('state')
  const state: LabState =
    stateParam === 'gestante' || stateParam === 'lactante' ? stateParam : 'padrao'

  if (ageYears === null || !sex) {
    const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
    const { data } = await supabase.rpc('get_patient_for_tenant', {
      p_tenant_id: args.tenantId,
      p_patient_id: args.patientId,
      p_key: key,
    } as never)
    const p = ((data as unknown as Array<{ birth_date: string | null; sex: string | null }>) ?? [])[0]
    if (p) {
      if (ageYears === null && p.birth_date) ageYears = ageFromBirth(p.birth_date)
      if (!sex && p.sex) sex = p.sex === 'masculino' ? 'M' : p.sex === 'feminino' ? 'F' : null
    }
  }

  // Classifica com o que houver. Sem sexo, os 16 analitos que dependem dele
  // saem como "sem referência" e o resto (69 das 85 faixas são iguais para
  // ambos) classifica normalmente — exigir o dado bloquearia tudo à toa, já que
  // em produção quase nenhum cadastro tem sexo/nascimento preenchidos.
  const ranges = await listLabRangesForPatient(supabase, { ageYears, sex, state })
  const panel = classifyLabResults(results, ranges)

  // Quantos exames JÁ LANÇADOS ficariam classificáveis se o sexo fosse
  // informado — é o que justifica pedir o dado, em vez de pedir sempre.
  let blockedBySex = 0
  if (!sex) {
    const sexDependent = await listSexDependentAnalytes(supabase)
    blockedBySex = panel.items.filter(
      (i) => i.class === 'sem_referencia' && sexDependent.has(i.analyteKey),
    ).length
  }

  return {
    patient: { ageYears, sex, state },
    panel,
    series,
    need: { age: ageYears === null, sex: !sex, blockedBySex },
  }
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
    const payload = await buildPayload(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      url: new URL(req.url),
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

    const payload = await buildPayload(supabase, {
      tenantId: session.tenantId,
      patientId: params.id,
      url: new URL(req.url),
    })
    return NextResponse.json({ recorded: measurements.length, ...payload }, { status: 201 })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
