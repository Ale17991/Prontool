/**
 * Checklist de hábitos — o motor de períodos, puro e sem I/O.
 *
 * A grade "renova sozinha" ao virar o período, mas NADA é materializado: as
 * marcações são gravadas por data absoluta e o período corrente é calculado a
 * partir da data de início. Isso evita um cron que criaria períodos vazios para
 * sempre, e faz o histórico existir de graça — período antigo é só um recorte
 * de datas sobre as mesmas marcações.
 *
 * Datas trafegam como `YYYY-MM-DD` (dia civil, sem fuso). Um hábito acontece no
 * dia da pessoa, não num instante UTC: gravar timestamp faria "domingo à noite"
 * virar segunda para metade do país.
 */

export type PeriodKind = 'semanal' | 'quinzenal' | 'mensal'

export interface Period {
  /** Índice desde o início do checklist. 0 = primeiro período. */
  index: number
  startDate: string
  endDate: string
  days: string[]
}

/** `YYYY-MM-DD` → dias desde a época, em dias civis (sem hora, sem fuso). */
export function toDayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`data inválida: ${isoDate}`)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function fromDayNumber(dayNumber: number): string {
  const dt = new Date(dayNumber * 86_400_000)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(isoDate: string, days: number): string {
  return fromDayNumber(toDayNumber(isoDate) + days)
}

/** Comprimento fixo em dias. Mensal é tratado por calendário, não aqui. */
const FIXED_LENGTH: Record<Exclude<PeriodKind, 'mensal'>, number> = {
  semanal: 7,
  quinzenal: 14,
}

function monthlyPeriod(startDate: string, index: number): Period {
  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number]
  // Mês é calendário, não "30 dias": um checklist que começa em 31/01 tem que
  // cair em 28/02, e somar dias fixos iria escorregando mês a mês.
  const start = new Date(Date.UTC(y, m - 1 + index, 1))
  const lastDayOfMonth = new Date(Date.UTC(y, m + index, 0)).getUTCDate()
  start.setUTCDate(Math.min(d, lastDayOfMonth))
  const next = new Date(Date.UTC(y, m + index, 1))
  const lastNext = new Date(Date.UTC(y, m + index + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(d, lastNext))

  const startIso = fromDayNumber(Math.floor(start.getTime() / 86_400_000))
  const endIso = fromDayNumber(Math.floor(next.getTime() / 86_400_000) - 1)
  return { index, startDate: startIso, endDate: endIso, days: daysBetween(startIso, endIso) }
}

export function daysBetween(startIso: string, endIso: string): string[] {
  const a = toDayNumber(startIso)
  const b = toDayNumber(endIso)
  const out: string[] = []
  for (let i = a; i <= b; i++) out.push(fromDayNumber(i))
  return out
}

/** O período de índice `index` de um checklist que começou em `startDate`. */
export function periodAt(startDate: string, kind: PeriodKind, index: number): Period {
  if (kind === 'mensal') return monthlyPeriod(startDate, index)
  const len = FIXED_LENGTH[kind]
  const start = addDays(startDate, index * len)
  const end = addDays(start, len - 1)
  return { index, startDate: start, endDate: end, days: daysBetween(start, end) }
}

/**
 * Índice do período que contém `today`. Antes do início devolve 0 — um
 * checklist agendado para começar amanhã mostra o primeiro período, e não um
 * índice negativo que quebraria a grade.
 */
export function periodIndexFor(startDate: string, kind: PeriodKind, today: string): number {
  if (toDayNumber(today) < toDayNumber(startDate)) return 0
  if (kind === 'mensal') {
    const [y, m, d] = startDate.split('-').map(Number) as [number, number, number]
    const [ty, tm, td] = today.split('-').map(Number) as [number, number, number]
    const months = (ty - y) * 12 + (tm - m)
    // Ainda não chegou o dia de virada neste mês → segue no período anterior.
    return td < Math.min(d, new Date(Date.UTC(ty, tm, 0)).getUTCDate()) ? months - 1 : months
  }
  const diff = toDayNumber(today) - toDayNumber(startDate)
  return Math.floor(diff / FIXED_LENGTH[kind])
}

export function currentPeriod(startDate: string, kind: PeriodKind, today: string): Period {
  return periodAt(startDate, kind, Math.max(0, periodIndexFor(startDate, kind, today)))
}

export function isWithin(period: Period, isoDate: string): boolean {
  const n = toDayNumber(isoDate)
  return n >= toDayNumber(period.startDate) && n <= toDayNumber(period.endDate)
}

export interface HabitItem {
  id: string
  label: string
}

export interface HabitMark {
  itemId: string
  markDate: string
}

export interface ItemStats {
  itemId: string
  label: string
  /** Dias marcados dentro do recorte. */
  markedDays: number
  /** Dias do recorte que já passaram (o futuro não conta como falha). */
  elapsedDays: number
  /** Maior sequência de dias seguidos marcados. */
  longestStreak: number
  /** Sequência que continua até hoje (0 se hoje/ontem não estão marcados). */
  currentStreak: number
}

/**
 * Estatística por item num recorte de dias.
 *
 * Deliberadamente NÃO devolve percentual de aderência. A marcação é binária e
 * o branco é ambíguo — não distingue "não fiz" de "não abri o app". Dizer
 * "aderência 60%" seria inventar precisão sobre um dado que não a tem; o
 * relatório diz "marcou 18 de 30 dias", que é o que se sabe de verdade.
 */
export function itemStats(args: {
  items: readonly HabitItem[]
  marks: readonly HabitMark[]
  days: readonly string[]
  today: string
}): ItemStats[] {
  const { items, marks, days, today } = args
  const todayN = toDayNumber(today)
  const elapsed = days.filter((d) => toDayNumber(d) <= todayN)

  return items.map((item) => {
    const marked = new Set(
      marks.filter((m) => m.itemId === item.id).map((m) => m.markDate),
    )
    let longest = 0
    let run = 0
    for (const d of days) {
      if (marked.has(d)) {
        run += 1
        if (run > longest) longest = run
      } else {
        run = 0
      }
    }

    // Sequência atual: conta para trás a partir de hoje. Se hoje ainda não foi
    // marcado, o dia ainda não acabou — então começa de ontem, senão a sequência
    // zeraria toda manhã e puniria a pessoa por acordar.
    let current = 0
    let cursor = marked.has(today) ? todayN : todayN - 1
    while (marked.has(fromDayNumber(cursor))) {
      current += 1
      cursor -= 1
    }

    return {
      itemId: item.id,
      label: item.label,
      markedDays: days.filter((d) => marked.has(d)).length,
      elapsedDays: elapsed.length,
      longestStreak: longest,
      currentStreak: current,
    }
  })
}
