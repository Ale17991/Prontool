'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { addDays, addMonths, startOfMonth, startOfWeek, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isMobileBreakpoint, isoDate, parseIsoDate } from '@/lib/utils/calendar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DoctorFilter, type DoctorFilterOption } from './calendar/doctor-filter'

type Grain = 'day' | 'week' | 'month'

interface Props {
  view: 'list' | 'cal'
  weekDate: Date
  grain: Grain
  doctorOptions: DoctorFilterOption[]
  selectedDoctors: string[]
}

export function AtendimentosToolbar({
  view,
  weekDate,
  grain,
  doctorOptions,
  selectedDoctors,
}: Props) {
  const router = useRouter()
  const search = useSearchParams()
  const [isMobile, setIsMobile] = useState(false)

  // Em mobile, forca grain=day independente do querystring (FR-011).
  useEffect(() => {
    function handle() {
      setIsMobile(isMobileBreakpoint(window.innerWidth))
    }
    handle()
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])

  const effectiveGrain: Grain = isMobile && view === 'cal' ? 'day' : grain

  function pushQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams(search?.toString() ?? '')
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k)
      else params.set(k, v)
    }
    router.push(`?${params.toString()}`)
  }

  function setView(next: 'list' | 'cal') {
    // Persiste preferencia por dispositivo via cookie (server le em SSR).
    if (typeof document !== 'undefined') {
      document.cookie = `pronttu_atendimentos_view=${next}; path=/; max-age=31536000; samesite=lax`
    }
    // Cal e default global, mas com cookie='cal' precisamos enviar explicito
    // na URL pra UI ser consistente em links compartilhaveis. Mantemos
    // querystring como override e cookie como persistencia.
    pushQuery({ view: next })
  }

  function navigate(direction: 'prev' | 'next') {
    const step = direction === 'next' ? 1 : -1
    const next =
      effectiveGrain === 'day'
        ? addDays(weekDate, step)
        : effectiveGrain === 'month'
          ? addMonths(weekDate, step)
          : addDays(weekDate, 7 * step)
    pushQuery({ week: isoDate(anchorForGrain(next, effectiveGrain)) })
  }

  function goToday() {
    pushQuery({ week: isoDate(anchorForGrain(new Date(), effectiveGrain)) })
  }

  function setGrain(g: Grain) {
    pushQuery({ grain: g === 'week' ? null : g })
  }

  const headerLabel = useMemo(
    () => formatHeaderLabel(weekDate, effectiveGrain),
    [weekDate, effectiveGrain],
  )

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setView('list')}
          className={cn(
            'flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-bold transition-colors',
            view === 'list' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          <List className="h-3.5 w-3.5" />
          Lista
        </button>
        <button
          type="button"
          onClick={() => setView('cal')}
          className={cn(
            'flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-bold transition-colors',
            view === 'cal' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Calendário
        </button>
      </div>

      {view === 'cal' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday} className="h-9">
            Hoje
          </Button>
          <div className="inline-flex items-center rounded-md border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => navigate('prev')}
              className="flex h-9 w-9 items-center justify-center text-slate-500 hover:bg-slate-50"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate('next')}
              className="flex h-9 w-9 items-center justify-center text-slate-500 hover:bg-slate-50"
              aria-label="Próximo"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <span className="text-sm font-bold text-slate-800">{headerLabel}</span>
          <Select
            value={effectiveGrain}
            onValueChange={(v) => setGrain(v as Grain)}
            disabled={isMobile}
          >
            <SelectTrigger className="h-9 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Dia</SelectItem>
              <SelectItem value="week">Semana</SelectItem>
              <SelectItem value="month">Mês</SelectItem>
            </SelectContent>
          </Select>
          <DoctorFilter doctors={doctorOptions} selected={selectedDoctors} />
        </div>
      ) : null}
    </div>
  )
}

function anchorForGrain(date: Date, grain: Grain): Date {
  if (grain === 'day') return date
  if (grain === 'month') return startOfMonth(date)
  return startOfWeek(date, { weekStartsOn: 0 })
}

function formatHeaderLabel(date: Date, grain: Grain): string {
  if (grain === 'day') return format(date, "EEEE, dd 'de' MMM", { locale: ptBR })
  if (grain === 'month') return format(date, "MMMM 'de' yyyy", { locale: ptBR })
  const start = startOfWeek(date, { weekStartsOn: 0 })
  const end = addDays(start, 6)
  return `${format(start, 'dd MMM', { locale: ptBR })} – ${format(end, 'dd MMM yyyy', { locale: ptBR })}`
}

// parseIsoDate is used by the page; re-export here to keep the toolbar
// import surface narrow.
export { parseIsoDate }
