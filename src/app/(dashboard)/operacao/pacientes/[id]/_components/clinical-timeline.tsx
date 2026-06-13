'use client'

import { useMemo, useState } from 'react'
import { Stethoscope } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { TimelineEventItem } from './timeline-event-item'
import type {
  AuthorMap,
  TimelineEvent,
  TimelineFilter,
} from '@/lib/core/patient-timeline'
import { formatAuthorDisplay } from '@/lib/core/patient-timeline'

interface Props {
  events: TimelineEvent[]
  authors: AuthorMap
  isAnonymized?: boolean
  /** Ver valores monetários (recepção não — esconde pagamentos e valor líquido). */
  canViewValues: boolean
}

const FILTERS: Array<{ key: TimelineFilter; label: string }> = [
  { key: 'todos', label: 'Tudo' },
  { key: 'evolucoes', label: 'Evoluções' },
  { key: 'anamneses', label: 'Anamneses' },
  { key: 'exames', label: 'Exames/Anexos' },
  { key: 'vitais', label: 'Sinais vitais' },
  { key: 'atendimentos', label: 'Atendimentos' },
  { key: 'pagamentos', label: 'Pagamentos' },
]

function matchesFilter(event: TimelineEvent, filter: TimelineFilter): boolean {
  switch (filter) {
    case 'todos':
      return true
    case 'evolucoes':
      return event.kind === 'evolucao'
    case 'anamneses':
      return event.kind === 'anamnese'
    case 'exames':
      return event.kind === 'arquivo'
    case 'vitais':
      return event.kind === 'vital'
    case 'atendimentos':
      return event.kind === 'appointment'
    case 'pagamentos':
      return event.kind === 'payment'
  }
}

export function ClinicalTimeline({ events: allEvents, authors, canViewValues }: Props) {
  const [filter, setFilter] = useState<TimelineFilter>('todos')

  // Recepção (sem finance.view_values): some os eventos de pagamento por inteiro.
  const events = useMemo(
    () => (canViewValues ? allEvents : allEvents.filter((e) => e.kind !== 'payment')),
    [allEvents, canViewValues],
  )
  const visibleFilters = useMemo(
    () => (canViewValues ? FILTERS : FILTERS.filter((f) => f.key !== 'pagamentos')),
    [canViewValues],
  )

  const counts = useMemo(() => {
    const out: Record<TimelineFilter, number> = {
      todos: events.length,
      evolucoes: 0,
      anamneses: 0,
      exames: 0,
      vitais: 0,
      atendimentos: 0,
      pagamentos: 0,
    }
    for (const e of events) {
      if (e.kind === 'evolucao') out.evolucoes++
      else if (e.kind === 'anamnese') out.anamneses++
      else if (e.kind === 'arquivo') out.exames++
      else if (e.kind === 'vital') out.vitais++
      else if (e.kind === 'appointment') out.atendimentos++
      else if (e.kind === 'payment') out.pagamentos++
    }
    return out
  }, [events])

  const filtered = useMemo(
    () => events.filter((e) => matchesFilter(e, filter)),
    [events, filter],
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Stethoscope className="h-4 w-4 text-primary" />
            Linha do tempo clínica
          </CardTitle>
          <span className="text-[11px] text-slate-400">
            {filtered.length} {filtered.length === 1 ? 'evento' : 'eventos'}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visibleFilters.map((f) => {
            const count = counts[f.key]
            const disabled = count === 0 && f.key !== 'todos'
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                disabled={disabled}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-bold transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  disabled && 'cursor-not-allowed opacity-40 hover:bg-slate-100',
                )}
              >
                {f.label}{count > 0 ? ` (${count})` : ''}
              </button>
            )
          })}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center">
            <p className="text-sm text-slate-500">
              {events.length === 0
                ? 'Sem eventos clínicos ainda.'
                : 'Nenhum evento neste filtro.'}
            </p>
            {filter !== 'todos' ? (
              <button
                type="button"
                onClick={() => setFilter('todos')}
                className="mt-2 text-[12px] font-bold text-primary hover:underline"
              >
                Limpar filtro
              </button>
            ) : null}
          </div>
        ) : (
          filtered.map((e) => (
            <TimelineEventItem
              key={e.id}
              event={e}
              authorDisplay={formatAuthorDisplay(authors, e.authorUserId)}
              canViewValues={canViewValues}
            />
          ))
        )}
      </CardContent>
    </Card>
  )
}
