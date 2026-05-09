'use client'

import { useEffect, useState } from 'react'
import { addMonths, addWeeks, format } from 'date-fns'
import { Filter, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CalendarFilters, CalendarStatus } from './use-calendar-filters'

export interface FilterBarProps {
  filters: CalendarFilters
  doctors: Array<{ id: string; fullName: string; active: boolean }>
  onChangeFilter: <K extends keyof CalendarFilters>(
    key: K,
    value: CalendarFilters[K] | null,
  ) => void
  onClear: () => void
}

const STATUS_OPTIONS: Array<{ value: CalendarStatus; label: string }> = [
  { value: 'agendado', label: 'Agendados' },
  { value: 'realizado', label: 'Realizados' },
  { value: 'cancelado', label: 'Cancelados' },
]

export function FilterBar({ filters, doctors, onChangeFilter, onClear }: FilterBarProps) {
  // Debounce nos campos de texto livre — evita disparar router.replace por keystroke.
  const [procedure, setProcedure] = useState(filters.procedure ?? '')
  const [patient, setPatient] = useState(filters.patient ?? '')

  useEffect(() => {
    setProcedure(filters.procedure ?? '')
  }, [filters.procedure])
  useEffect(() => {
    setPatient(filters.patient ?? '')
  }, [filters.patient])

  useEffect(() => {
    if ((filters.procedure ?? '') === procedure) return
    const t = setTimeout(() => onChangeFilter('procedure', procedure || null), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procedure])

  useEffect(() => {
    if ((filters.patient ?? '') === patient) return
    const t = setTimeout(() => onChangeFilter('patient', patient || null), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient])

  const hasAnyFilter =
    filters.from !== null ||
    filters.to !== null ||
    filters.doctor !== null ||
    filters.status !== null ||
    filters.procedure !== null ||
    filters.patient !== null

  function applyShortcut(kind: 'today' | 'this-week' | 'this-month' | 'next-week' | 'next-month') {
    const today = new Date()
    switch (kind) {
      case 'today':
        onChangeFilter('view', 'dia')
        onChangeFilter('date', format(today, 'yyyy-MM-dd'))
        return
      case 'this-week':
        onChangeFilter('view', 'semana')
        onChangeFilter('date', format(today, 'yyyy-MM-dd'))
        return
      case 'this-month':
        onChangeFilter('view', 'mes')
        onChangeFilter('date', format(today, 'yyyy-MM-dd'))
        return
      case 'next-week':
        onChangeFilter('view', 'semana')
        onChangeFilter('date', format(addWeeks(today, 1), 'yyyy-MM-dd'))
        return
      case 'next-month':
        onChangeFilter('view', 'mes')
        onChangeFilter('date', format(addMonths(today, 1), 'yyyy-MM-dd'))
        return
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-slate-700">Filtros</span>
          {hasAnyFilter ? <Badge variant="secondary">Ativos</Badge> : null}
        </div>
        {hasAnyFilter ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="mr-1 h-3 w-3" /> Limpar
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['today', 'Hoje'],
            ['this-week', 'Esta semana'],
            ['this-month', 'Este mês'],
            ['next-week', 'Próxima semana'],
            ['next-month', 'Próximo mês'],
          ] as const
        ).map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            onClick={() => applyShortcut(kind)}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
              'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="filter-doctor" className="text-[11px]">
            Profissional
          </Label>
          <select
            id="filter-doctor"
            value={filters.doctor ?? ''}
            onChange={(e) => onChangeFilter('doctor', e.target.value || null)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs"
          >
            <option value="">Todos</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
                {d.active ? '' : ' (inativo)'}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-status" className="text-[11px]">
            Status
          </Label>
          <select
            id="filter-status"
            value={filters.status ?? ''}
            onChange={(e) =>
              onChangeFilter(
                'status',
                (e.target.value as CalendarStatus | '') || null,
              )
            }
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs"
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-procedure" className="text-[11px]">
            Procedimento
          </Label>
          <Input
            id="filter-procedure"
            type="text"
            value={procedure}
            maxLength={60}
            onChange={(e) => setProcedure(e.target.value)}
            placeholder="Ex.: limpeza"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-patient" className="text-[11px]">
            Paciente
          </Label>
          <Input
            id="filter-patient"
            type="text"
            value={patient}
            maxLength={60}
            onChange={(e) => setPatient(e.target.value)}
            placeholder="Ex.: Maria"
          />
        </div>
      </div>
    </div>
  )
}
