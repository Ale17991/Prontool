/**
 * Datas do portal, no fuso da CLÍNICA.
 *
 * Vive fora do `page-guard` porque este importa `next/navigation`: formatação de
 * data não deveria arrastar o roteador para dentro de um teste de unidade.
 *
 * `TIMESTAMPTZ` cortado como string ISO mostraria o dia seguinte para tudo que
 * acontece à noite — a mesma doutrina da 054 nos impressos.
 */

function clinicTz(): string {
  return process.env.CLINIC_TIMEZONE || 'America/Sao_Paulo'
}

/** Dia civil da clínica (`YYYY-MM-DD`) — o critério da marcação de hábitos. */
export function todayInClinicTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: clinicTz(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** `13/08/2026`. */
export function brDayInClinicTz(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: clinicTz(),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

/**
 * `13/08/2026` a partir de uma coluna `DATE` (`YYYY-MM-DD`).
 *
 * Coluna `DATE` não tem fuso, e por isso NÃO pode passar por `brDayInClinicTz`:
 * ali `new Date('2026-08-14')` é meia-noite em UTC, que no fuso da clínica ainda
 * é dia 13 — toda avaliação apareceria com a data da véspera. A distinção é a
 * mesma que a 054 firmou entre `brDate` e `brDateTz`: o erro tem sentidos
 * opostos e só se enxerga sabendo de que coluna o valor veio.
 *
 * Grafia inesperada devolve travessão em vez de uma data inventada.
 */
export function brDateOnly(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

/**
 * `14/08 às 15h` ou `14/08 às 15h30`. Sem o ano: a linha é sobre o que vem a
 * seguir, não sobre arquivo.
 */
export function brDayTimeInClinicTz(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const tz = clinicTz()
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
  }).format(d)
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${day} às ${minute === '00' ? `${hour}h` : `${hour}h${minute}`}`
}
