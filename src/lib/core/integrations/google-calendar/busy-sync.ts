import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getTenantTimezone } from '@/lib/utils/tenant-tz'
import { withGoogleAuth } from '@/lib/integrations/google-calendar/oauth/with-auth'
import { getFreeBusy, type BusyInterval } from '@/lib/integrations/google-calendar/calendar-client'
import { logger } from '@/lib/observability/logger'

/**
 * ENTRADA do Google Calendar: espelha os horários OCUPADOS da agenda pessoal do
 * médico como BLOQUEIO na nossa agenda (sem nenhum detalhe — só o intervalo).
 *
 * Estratégia "sob demanda + cache": chamado ao abrir a agenda. Só chama o Google
 * se passou o TTL (user_integrations.busy_synced_at). Os blocos espelhados são
 * `schedule_blocks` com source='google' (soft-delete + re-insert no refresh),
 * então renderizam exatamente como um bloqueio manual.
 */

const PROVIDER = 'google_calendar'
const TTL_MINUTES = 10
const BLOCK_REASON = 'Indisponível'

function loose(supabase: SupabaseClient<Database>): SupabaseClient {
  return supabase as unknown as SupabaseClient
}

// ---- helpers de fuso (Intl, como tenant-tz.ts) --------------------------

function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  )
  return asUtc - date.getTime()
}

/** UTC ISO da meia-noite local (00:00 do `ymd` no fuso `tz`). */
function localMidnightUtcIso(ymd: string, tz: string): string {
  const naive = new Date(`${ymd}T00:00:00Z`)
  const offset = tzOffsetMs(naive, tz)
  return new Date(naive.getTime() - offset).toISOString()
}

/** Componentes locais (data + HH:MM) de um instante UTC, no fuso `tz`. */
function utcToLocalParts(iso: string, tz: string): { ymd: string; hm: string } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(new Date(iso))) p[part.type] = part.value
  const hour = p.hour === '24' ? '00' : p.hour
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${hour}:${p.minute}` }
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

interface BlockRow {
  blockDate: string
  allDay: boolean
  startTime: string | null
  endTime: string | null
}

/** Quebra um intervalo busy (UTC) em blocos por dia local, respeitando o CHECK. */
function splitInterval(interval: BusyInterval, tz: string): BlockRow[] {
  const start = utcToLocalParts(interval.start, tz)
  const end = utcToLocalParts(interval.end, tz)
  const out: BlockRow[] = []

  if (start.ymd === end.ymd) {
    if (end.hm > start.hm)
      out.push({ blockDate: start.ymd, allDay: false, startTime: start.hm, endTime: end.hm })
    return out
  }
  // Primeiro dia: do início até o fim do dia (TIME não aceita 24:00 → 23:59).
  if (start.hm < '23:59')
    out.push({ blockDate: start.ymd, allDay: false, startTime: start.hm, endTime: '23:59' })
  // Dias do meio: dia inteiro.
  for (let d = addDaysYmd(start.ymd, 1); d < end.ymd; d = addDaysYmd(d, 1)) {
    out.push({ blockDate: d, allDay: true, startTime: null, endTime: null })
  }
  // Último dia: da meia-noite até o fim (pula se terminar exatamente 00:00).
  if (end.hm > '00:00')
    out.push({ blockDate: end.ymd, allDay: false, startTime: '00:00', endTime: end.hm })
  return out
}

// ---- sync por médico -----------------------------------------------------

interface UserIntegrationLite {
  status: string
  enabled: boolean
  busy_synced_at: string | null
  updated_at: string
}

async function syncDoctorGoogleBusy(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    doctorId: string
    userId: string
    fromYmd: string
    toYmd: string
    tz: string
  },
): Promise<void> {
  const sb = loose(supabase)
  const { data } = await sb
    .from('user_integrations')
    .select('status, enabled, busy_synced_at, updated_at')
    .eq('user_id', args.userId)
    .eq('tenant_id', args.tenantId)
    .eq('provider', PROVIDER)
    .maybeSingle()
  const row = data as UserIntegrationLite | null
  if (!row || !row.enabled || row.status !== 'connected') return

  // Claim ATÔMICO do TTL: marca busy_synced_at=now() só se estava vazio ou
  // vencido. Se nenhuma linha casar, outra carga concorrente já reivindicou (ou
  // o cache está fresco) → sai sem duplicar blocos.
  const cutoff = new Date(Date.now() - TTL_MINUTES * 60_000).toISOString()
  const claim = await sb
    .from('user_integrations')
    .update({ busy_synced_at: new Date().toISOString() })
    .eq('user_id', args.userId)
    .eq('tenant_id', args.tenantId)
    .eq('provider', PROVIDER)
    .or(`busy_synced_at.is.null,busy_synced_at.lt.${cutoff}`)
    .select('user_id')
  if (claim.error || !claim.data || claim.data.length === 0) return

  const auth = await withGoogleAuth(supabase, args.userId, args.tenantId)
  if (auth.kind !== 'connected') return
  const calendarId = auth.connection.config.calendar_id || 'primary'

  const timeMin = localMidnightUtcIso(args.fromYmd, args.tz)
  const timeMax = localMidnightUtcIso(addDaysYmd(args.toYmd, 1), args.tz)

  const busy = await getFreeBusy(auth.accessToken, calendarId, timeMin, timeMax)
  const blocks = busy.flatMap((b) => splitInterval(b, args.tz))

  // Soft-delete dos blocos google ativos do médico na janela (refresh).
  await sb
    .from('schedule_blocks')
    .update({ deleted_at: new Date().toISOString(), deleted_by: args.userId })
    .eq('tenant_id', args.tenantId)
    .eq('doctor_id', args.doctorId)
    .eq('source', 'google')
    .is('deleted_at', null)
    .gte('block_date', args.fromYmd)
    .lte('block_date', args.toYmd)

  if (blocks.length > 0) {
    const rows = blocks.map((b) => ({
      tenant_id: args.tenantId,
      doctor_id: args.doctorId,
      block_date: b.blockDate,
      start_time: b.startTime,
      end_time: b.endTime,
      all_day: b.allDay,
      reason: BLOCK_REASON,
      source: 'google',
      created_by: args.userId,
    }))
    const ins = await sb.from('schedule_blocks').insert(rows)
    if (ins.error) throw new Error(`insert google blocks: ${ins.error.message}`)
  }
  // busy_synced_at já foi marcado no claim atômico acima.
}

/**
 * Sincroniza os horários ocupados do Google para a janela visível da agenda.
 * Best-effort: nunca lança (não derruba o render da agenda). Sincroniza só os
 * médicos vinculados a usuário (e, desses, só os que conectaram o Google — o
 * resto é no-op barato). Com filtro de médico, sincroniza apenas ele.
 */
export async function syncGoogleBusyForAgenda(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; doctorId?: string; fromYmd: string; toYmd: string; tz?: string },
): Promise<void> {
  try {
    const tz = args.tz ?? (await getTenantTimezone(supabase, args.tenantId))
    const sb = loose(supabase)
    let q = sb
      .from('doctors')
      .select('id, user_id')
      .eq('tenant_id', args.tenantId)
      .not('user_id', 'is', null)
    if (args.doctorId) q = q.eq('id', args.doctorId)
    const { data } = await q
    const doctors = (data ?? []) as Array<{ id: string; user_id: string | null }>

    await Promise.all(
      doctors
        .filter((d) => d.user_id)
        .map((d) =>
          syncDoctorGoogleBusy(supabase, {
            tenantId: args.tenantId,
            doctorId: d.id,
            userId: d.user_id!,
            fromYmd: args.fromYmd,
            toYmd: args.toYmd,
            tz,
          }).catch((err) =>
            logger.error(
              { err: (err as Error).message, doctorId: d.id },
              'google-busy-sync-doctor-failed',
            ),
          ),
        ),
    )
  } catch (err) {
    logger.error(
      { err: (err as Error).message, tenantId: args.tenantId },
      'google-busy-sync-failed',
    )
  }
}
