import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { listScheduleBlocks } from '@/lib/core/schedule-blocks/list'
import { toHttpResponse } from '@/lib/observability/http'

/**
 * GET /api/atendimentos/agenda-dia?doctor_id=&start=&end=&date=
 *
 * Lista os horários OCUPADOS de um profissional no dia (atendimentos ativos +
 * bloqueios de agenda — inclusive os espelhados do Google). UX preventiva:
 * o formulário de novo atendimento mostra isso para evitar conflito antes do
 * submit. Sem PII — só faixas de horário e um rótulo genérico.
 */
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  doctor_id: z.string().uuid(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export interface DaySlot {
  kind: 'appointment' | 'block'
  /** Atendimento: ISO absoluto (cliente formata em hora local). */
  startIso: string | null
  endIso: string | null
  /** Bloqueio: hora local HH:MM (já é wall-clock da clínica). */
  startHm: string | null
  endHm: string | null
  allDay: boolean
  label: string
}

export async function GET(req: Request): Promise<Response> {
  const route = '/api/atendimentos/agenda-dia'
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      { entity: 'appointments', route, request: req },
    )

    const url = new URL(req.url)
    const parsed = querySchema.safeParse({
      doctor_id: url.searchParams.get('doctor_id'),
      start: url.searchParams.get('start'),
      end: url.searchParams.get('end'),
      date: url.searchParams.get('date'),
    })
    if (!parsed.success) {
      return NextResponse.json({ error: { code: 'INVALID_QUERY', message: 'parâmetros inválidos' } }, { status: 400 })
    }

    const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>

    const [apptRes, blocks] = await Promise.all([
      supabase
        .from('appointments_effective')
        .select('appointment_at, duration_minutes, effective_status')
        .eq('tenant_id', session.tenantId)
        .eq('doctor_id', parsed.data.doctor_id)
        .gte('appointment_at', parsed.data.start)
        .lt('appointment_at', parsed.data.end)
        .order('appointment_at', { ascending: true })
        .limit(100),
      listScheduleBlocks(supabase, {
        tenantId: session.tenantId,
        from: parsed.data.date,
        to: parsed.data.date,
        doctorId: parsed.data.doctor_id,
      }).catch(() => []),
    ])

    const slots: DaySlot[] = []

    type ApptRow = { appointment_at: string; duration_minutes: number | null; effective_status: string | null }
    for (const r of ((apptRes.data ?? []) as unknown as ApptRow[])) {
      if (r.effective_status === 'cancelado' || r.effective_status === 'estornado') continue
      const start = new Date(r.appointment_at)
      const end = new Date(start.getTime() + (r.duration_minutes ?? 30) * 60_000)
      slots.push({
        kind: 'appointment',
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        startHm: null,
        endHm: null,
        allDay: false,
        label: 'Ocupado',
      })
    }

    for (const b of blocks) {
      slots.push({
        kind: 'block',
        startIso: null,
        endIso: null,
        startHm: b.allDay ? null : (b.startTime?.slice(0, 5) ?? null),
        endHm: b.allDay ? null : (b.endTime?.slice(0, 5) ?? null),
        allDay: b.allDay,
        label: b.reason || 'Bloqueio',
      })
    }

    return NextResponse.json({ slots })
  } catch (err) {
    return toHttpResponse(err, { route })
  }
}
