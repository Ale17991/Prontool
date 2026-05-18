import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Camada 3 — fix da TZ drift sistemática nos relatórios.
 *
 * Problema (antes desta utility): código tratava `YYYY-MM-DD` digitado pelo
 * user como **UTC midnight**, fazendo `${ymd}T00:00:00Z`. Para tenant em
 * São Paulo (UTC-3), `2026-01-01T00:00:00Z` é `2025-12-31 21:00 BRT` —
 * agendamentos entre 21:00 e 23:59 BRT no último dia do mês ficavam no
 * relatório do mês seguinte. Espelho ocorria na borda inferior.
 *
 * Esta utility resolve YYYY-MM-DD → meia-noite **no fuso do tenant** →
 * ISO UTC. Sem novas deps (`Intl.DateTimeFormat` cobre DST automaticamente
 * em qualquer fuso IANA).
 *
 * Tenant timezone vem de `tenants.timezone` (DEFAULT 'America/Sao_Paulo'
 * em 0002). Cache trivial in-memory por request: o caller chama
 * `getTenantTimezone` uma vez e passa para as funções de conversão.
 */

const DEFAULT_TZ = 'America/Sao_Paulo'

/**
 * Lê `tenants.timezone`. Fallback defensivo para 'America/Sao_Paulo' se
 * row sumiu ou coluna vier null (não deveria acontecer dado o DEFAULT).
 */
export async function getTenantTimezone(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('tenants')
    .select('timezone')
    .eq('id', tenantId)
    .maybeSingle()
  if (error) {
    // Falha de query NÃO derruba relatório — degrada para default.
    return DEFAULT_TZ
  }
  return (data as { timezone?: string | null } | null)?.timezone ?? DEFAULT_TZ
}

/**
 * `ymd` (`YYYY-MM-DD`) interpretado como meia-noite no fuso `tz` → ISO UTC.
 *
 * Exemplo: `ymdStartOfDayUtc('2026-01-01', 'America/Sao_Paulo')`
 *          → `'2026-01-01T03:00:00.000Z'` (= 00:00 BRT).
 */
export function ymdStartOfDayUtc(ymd: string, tz: string): string {
  return shiftYmdToTz(ymd, tz)
}

/**
 * `ymd + 1 dia` interpretado como meia-noite no fuso `tz` → ISO UTC.
 * Use como upper bound EXCLUSIVO de range (`.lt('appointment_at', this)`).
 *
 * Exemplo: `ymdNextDayStartUtc('2026-01-31', 'America/Sao_Paulo')`
 *          → `'2026-02-01T03:00:00.000Z'` (= 00:00 BRT do dia 1/02).
 */
export function ymdNextDayStartUtc(ymd: string, tz: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) {
    throw new Error(`ymdNextDayStartUtc: invalid ymd '${ymd}'`)
  }
  // Avança 1 dia em UTC, depois converte ymd resultante para tz.
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const nextYmd = next.toISOString().slice(0, 10)
  return shiftYmdToTz(nextYmd, tz)
}

/**
 * Converte um `Date` (instant absoluto) para a representação YYYY-MM-DD
 * **no fuso do tenant**. Usado em resolvePrice/resolveCommission (T3) para
 * pegar a data "do ponto de vista do user" — agendamento criado às
 * 22:30 BRT no dia 31 retorna `'2026-01-31'`, não `'2026-02-01'`.
 */
export function dateToTenantYmd(at: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // en-CA já retorna YYYY-MM-DD direto; mais robusto que pt-BR (DD/MM/YYYY).
  return fmt.format(at)
}

// =========================================================================
// Internals
// =========================================================================

function shiftYmdToTz(ymd: string, tz: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) {
    throw new Error(`shiftYmdToTz: invalid ymd '${ymd}'`)
  }
  // Chute UTC (trata ymd como UTC midnight) e mede o offset do tz nesse
  // instante. DST é resolvido automaticamente porque o offset é medido
  // *no instante* — `Intl.DateTimeFormat` consulta a tzdb do runtime.
  const utcGuess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  const offsetMs = tzOffsetMsAt(tz, utcGuess)
  return new Date(utcGuess.getTime() - offsetMs).toISOString()
}

/**
 * Offset de `tz` em relação a UTC, em ms, no instante `at`.
 * Positivo se `tz` está à frente de UTC; negativo se atrás (Brasil = -3h
 * = -10_800_000 ms).
 */
function tzOffsetMsAt(tz: string, at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23', // força 00-23 em vez de 1-24 (alguns locales)
  })
  const parts = fmt.formatToParts(at)
  let year = 0
  let month = 1
  let day = 1
  let hour = 0
  let minute = 0
  let second = 0
  for (const p of parts) {
    switch (p.type) {
      case 'year':
        year = Number(p.value)
        break
      case 'month':
        month = Number(p.value)
        break
      case 'day':
        day = Number(p.value)
        break
      case 'hour':
        hour = Number(p.value)
        break
      case 'minute':
        minute = Number(p.value)
        break
      case 'second':
        second = Number(p.value)
        break
    }
  }
  const tzAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  return tzAsUtc - at.getTime()
}
