/**
 * Checklist de hábitos no portal — GET a grade, POST a marcação.
 *
 * **Esta é a primeira escrita que o portal aceita do paciente.** A regra que
 * governa o arquivo inteiro: tenant e paciente saem EXCLUSIVAMENTE do cookie
 * HMAC verificado. O corpo do pedido diz apenas QUAL hábito e QUE dia — nunca
 * de quem é o dado. Um corpo forjado não alcança outro paciente porque não há
 * campo no corpo que o identifique.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { readPatientSessionFromRequest } from '@/lib/core/patient-portal/session'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { listEnabledPortalSections } from '@/lib/core/patient-portal/sections'
import { getGrid, toggleMark, HabitMarkError } from '@/lib/core/habits/store'
import { hashIpForPatientPortal, logPatientAccess } from '@/lib/core/patient-portal/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const markSchema = z.object({
  itemId: z.string().min(1).max(60),
  markDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  marked: z.boolean(),
})

function extractIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return request.headers.get('x-real-ip')?.trim() ?? 'unknown'
}

function unauthorized(): Response {
  return NextResponse.json(
    { error: { code: 'SESSION_INVALID', message: 'Sessão ausente ou expirada.' } },
    { status: 401 },
  )
}

/**
 * O dia "de hoje" é o dia civil da clínica, não o do relógio do servidor nem o
 * do celular do paciente: marcar às 23h de domingo em São Paulo tem que cair no
 * domingo, e confiar na data enviada pelo cliente permitiria marcar qualquer
 * dia burlando o limite do período.
 */
function todayInClinicTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.CLINIC_TIMEZONE || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** A seção precisa estar ligada pela clínica E o módulo disponível no plano. */
async function sectionEnabled(tenantId: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient()
  const ent = await getTenantEntitlements(supabase, tenantId)
  const enabled = await listEnabledPortalSections(supabase, tenantId, {
    hasModule: (m) => ent.hasModule(m),
  })
  return enabled.includes('habitos')
}

export async function GET(request: NextRequest): Promise<Response> {
  const session = readPatientSessionFromRequest(request)
  if (!session) return unauthorized()
  if (!(await sectionEnabled(session.tenantId))) {
    return NextResponse.json({ grid: null }, { status: 200 })
  }

  const supabase = createSupabaseServiceClient()
  const grid = await getGrid(supabase, {
    tenantId: session.tenantId,
    patientId: session.patientId,
    today: todayInClinicTz(),
  })
  return NextResponse.json({ grid }, { status: 200 })
}

export async function POST(request: NextRequest): Promise<Response> {
  const session = readPatientSessionFromRequest(request)
  if (!session) return unauthorized()
  if (!(await sectionEnabled(session.tenantId))) {
    return NextResponse.json(
      { error: { code: 'SECTION_DISABLED', message: 'Indisponível.' } },
      { status: 404 },
    )
  }

  const parsed = markSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'Payload inválido.' } },
      { status: 400 },
    )
  }

  const supabase = createSupabaseServiceClient()
  const today = todayInClinicTz()
  try {
    await toggleMark(supabase, {
      tenantId: session.tenantId,
      patientId: session.patientId,
      itemId: parsed.data.itemId,
      markDate: parsed.data.markDate,
      marked: parsed.data.marked,
      today,
      markedBy: 'paciente',
    })
  } catch (err) {
    if (err instanceof HabitMarkError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.code === 'NO_CHECKLIST' ? 404 : 422 },
      )
    }
    throw err
  }

  await logPatientAccess({
    supabase,
    tenantId: session.tenantId,
    patientId: session.patientId,
    action: 'habit_mark',
    ipHash: hashIpForPatientPortal(extractIp(request), session.tenantId),
    userAgent: request.headers.get('user-agent'),
  })

  // Devolve a grade inteira: a tela reflete o estado do servidor em vez de
  // confiar no otimismo local, que ficaria mentindo se a gravação falhasse.
  const grid = await getGrid(supabase, {
    tenantId: session.tenantId,
    patientId: session.patientId,
    today,
  })
  return NextResponse.json({ grid }, { status: 200 })
}
