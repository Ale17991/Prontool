/**
 * Modo "sem preferencia de profissional" — escolhe qual medico atribuir
 * a um slot. Regra: menor numero de appointments na semana do slot;
 * empate vai pra random uniform entre os empatados.
 *
 * `tenant_id` e' aplicado no fetch para nao vazar appointments de outros
 * tenants (alem do RLS, que so' bloqueia anon).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { listPublicBookingSlots } from './list-slots'

const TENANT_TIMEZONE = 'America/Sao_Paulo'

function isoStringInTz(date: Date, tz: string): string {
  // Formata a data no fuso da clinica para extrair YYYY-MM-DD local.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(date)
}

/**
 * Janela [domingo 00:00, domingo seguinte 00:00) da semana que contem
 * `slotDate` no fuso da clinica. Retorna ISO strings UTC.
 */
function weekRangeIso(slotDate: Date, tz: string): { start: string; end: string } {
  const localDateStr = isoStringInTz(slotDate, tz)
  const [y, m, d] = localDateStr.split('-').map(Number)
  // Date construido em UTC representa meia-noite LOCAL nao perfeitamente, mas
  // para contar dia-da-semana e' OK porque getUTCDay reflete o dia local
  // quando criado via Date.UTC com os componentes locais.
  const localMidnight = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1))
  const weekday = localMidnight.getUTCDay() // 0 = dom
  const weekStart = new Date(localMidnight.getTime() - weekday * 24 * 3600 * 1000)
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000)
  return {
    start: weekStart.toISOString(),
    end: weekEnd.toISOString(),
  }
}

export interface PickAnyDoctorInput {
  slug: string
  tenantId: string
  procedureId: string
  slotStartIso: string
  candidateDoctorIds: string[]
}

export interface PickAnyDoctorResult {
  doctorId: string
  appointmentsInWeek: number
}

/**
 * Filtra candidatos que tem o slot livre + escolhe o de menor carga na
 * semana do slot. Empate -> random uniform.
 *
 * Retorna null se nenhum candidato esta com o slot livre.
 */
export async function pickAnyDoctorForSlot(
  supabase: SupabaseClient<Database>,
  input: PickAnyDoctorInput,
): Promise<PickAnyDoctorResult | null> {
  if (input.candidateDoctorIds.length === 0) return null

  const slotDate = new Date(input.slotStartIso)
  const slotDay = isoStringInTz(slotDate, TENANT_TIMEZONE)

  // 1) Filtra candidatos que ainda tem o slot disponivel.
  const availability = await Promise.allSettled(
    input.candidateDoctorIds.map(async (doctorId) => {
      const slots = await listPublicBookingSlots(supabase, {
        slug: input.slug,
        doctorId,
        procedureId: input.procedureId,
        from: slotDay,
        to: slotDay,
      })
      const free = slots.some((s) => s.start === input.slotStartIso)
      return { doctorId, free }
    }),
  )
  const available = availability
    .filter(
      (r): r is PromiseFulfilledResult<{ doctorId: string; free: boolean }> =>
        r.status === 'fulfilled' && r.value.free,
    )
    .map((r) => r.value.doctorId)

  if (available.length === 0) return null

  // 2) Conta appointments por medico na semana do slot.
  const week = weekRangeIso(slotDate, TENANT_TIMEZONE)
  const counts = await Promise.allSettled(
    available.map(async (doctorId) => {
      const { count, error } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', input.tenantId)
        .eq('doctor_id', doctorId)
        .gte('appointment_at', week.start)
        .lt('appointment_at', week.end)
      if (error) {
        return { doctorId, count: Number.POSITIVE_INFINITY }
      }
      return { doctorId, count: count ?? 0 }
    }),
  )

  const tallies = counts
    .filter(
      (r): r is PromiseFulfilledResult<{ doctorId: string; count: number }> =>
        r.status === 'fulfilled',
    )
    .map((r) => r.value)

  if (tallies.length === 0) {
    // Fallback random puro entre os disponiveis.
    const pick = available[Math.floor(Math.random() * available.length)]!
    return { doctorId: pick, appointmentsInWeek: 0 }
  }

  // 3) Escolhe o(s) com menor carga, random tiebreak.
  const min = Math.min(...tallies.map((t) => t.count))
  const winners = tallies.filter((t) => t.count === min)
  const chosen = winners[Math.floor(Math.random() * winners.length)]!

  return { doctorId: chosen.doctorId, appointmentsInWeek: chosen.count }
}
