import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { cn } from '@/lib/utils'

export interface PeriodShortcutsProps {
  /** Rota base; botões navegam para `${basePath}?from=YYYY-MM-DD&to=YYYY-MM-DD`. */
  basePath: string
  /** Período atualmente aplicado — destaca o botão correspondente. */
  currentFrom?: string
  currentTo?: string
  /** Query params extras a preservar na URL (ex.: filtros adicionais). */
  preserveParams?: Record<string, string | undefined>
  className?: string
}

interface Shortcut {
  key: 'today' | 'this-week' | 'this-month' | 'next-week' | 'next-month'
  label: string
  range: { from: string; to: string }
}

function buildShortcuts(now: Date): Shortcut[] {
  // weekStartsOn: 0 (domingo) — mesma convenção do calendário do projeto
  // (ver src/app/(dashboard)/operacao/atendimentos/calendar-filters.ts).
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
  const today = fmt(now)
  return [
    { key: 'today', label: 'Hoje', range: { from: today, to: today } },
    {
      key: 'this-week',
      label: 'Esta semana',
      range: {
        from: fmt(startOfWeek(now, { weekStartsOn: 0 })),
        to: fmt(endOfWeek(now, { weekStartsOn: 0 })),
      },
    },
    {
      key: 'this-month',
      label: 'Este mês',
      range: { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) },
    },
    {
      key: 'next-week',
      label: 'Próxima semana',
      range: {
        from: fmt(startOfWeek(addWeeks(now, 1), { weekStartsOn: 0 })),
        to: fmt(endOfWeek(addWeeks(now, 1), { weekStartsOn: 0 })),
      },
    },
    {
      key: 'next-month',
      label: 'Próximo mês',
      range: {
        from: fmt(startOfMonth(addMonths(now, 1))),
        to: fmt(endOfMonth(addMonths(now, 1))),
      },
    },
  ]
}

export function PeriodShortcuts({
  basePath,
  currentFrom,
  currentTo,
  preserveParams,
  className,
}: PeriodShortcutsProps) {
  const shortcuts = buildShortcuts(new Date())
  return (
    <div
      className={cn(
        'flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0',
        className,
      )}
    >
      {shortcuts.map((s) => {
        const active = currentFrom === s.range.from && currentTo === s.range.to
        const params = new URLSearchParams()
        params.set('from', s.range.from)
        params.set('to', s.range.to)
        if (preserveParams) {
          for (const [k, v] of Object.entries(preserveParams)) {
            if (v) params.set(k, v)
          }
        }
        return (
          <a
            key={s.key}
            href={`${basePath}?${params.toString()}`}
            className={cn(
              'shrink-0 rounded-md border px-3 py-1.5 text-xs font-bold transition-colors',
              active
                ? 'border-primary bg-primary text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {s.label}
          </a>
        )
      })}
    </div>
  )
}
