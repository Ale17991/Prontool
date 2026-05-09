'use client'

import {
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * Feature 010 (US4 / R12) — visualização Mês.
 *
 * Grid 7×5–6. Cada célula:
 *   - cabeçalho com número do dia (vazio para dias fora do mês)
 *   - até 3 chips de atendimento (cor por status)
 *   - chip "+N mais" quando excede 3 → leva ao Day-view do dia.
 *   - clique em célula vazia abre /operacao/atendimentos/novo?date=...
 *
 * `appointments` deve ser pré-filtrado pelo SSR — este componente só
 * agrupa por dia.
 */

export interface MonthViewAppointment {
  id: string
  appointmentAt: string // ISO timestamp
  effectiveStatus: 'agendado' | 'realizado' | 'cancelado' | 'ativo' | 'estornado' | string
  patientLabel: string
  procedureLabel: string | null
  doctorLabel: string | null
}

interface MonthViewProps {
  date: Date
  appointments: MonthViewAppointment[]
}

const WEEK_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const STATUS_COLOR: Record<string, string> = {
  agendado: 'border-sky-300 bg-sky-50 text-sky-800',
  ativo: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  realizado: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  cancelado: 'border-slate-300 bg-slate-100 text-slate-600 line-through',
  estornado: 'border-slate-300 bg-slate-100 text-slate-600 line-through',
}

export function MonthView({ date, appointments }: MonthViewProps) {
  const monthAnchor = startOfMonth(date)
  const gridStart = startOfWeek(monthAnchor, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 0 })

  const days: Date[] = []
  for (let cur = new Date(gridStart); cur <= gridEnd; cur.setDate(cur.getDate() + 1)) {
    days.push(new Date(cur))
  }

  // Agrupa atendimentos por dia (yyyy-MM-dd).
  const byDay = new Map<string, MonthViewAppointment[]>()
  for (const a of appointments) {
    const key = a.appointmentAt.slice(0, 10) // 'YYYY-MM-DD' (UTC, mas suficiente para grouping)
    const list = byDay.get(key) ?? []
    list.push(a)
    byDay.set(key, list)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-bold uppercase text-slate-500">
        {WEEK_LABELS.map((label) => (
          <div key={label} className="py-2">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-[repeat(auto-fill,minmax(110px,1fr))]">
        {days.map((d) => {
          const inMonth = isSameMonth(d, monthAnchor)
          const isToday = isSameDay(d, new Date())
          const iso = format(d, 'yyyy-MM-dd')
          const items = byDay.get(iso) ?? []
          const visible = items.slice(0, 3)
          const overflow = items.length - visible.length
          return (
            <div
              key={iso}
              className={cn(
                'flex flex-col gap-1 border-b border-r border-slate-100 p-1.5',
                inMonth ? 'bg-white' : 'bg-slate-50/60 text-slate-300',
              )}
            >
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <span className={isToday ? 'rounded-full bg-primary px-1.5 py-0.5 text-white' : 'text-slate-600'}>
                  {d.getDate()}
                </span>
                {items.length > 0 ? (
                  <span className="text-[10px] text-slate-400">
                    {items.length} {items.length === 1 ? 'cons.' : 'cons.'}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1">
                {visible.map((a) => (
                  <Link
                    key={a.id}
                    href={`/operacao/atendimentos/${a.id}`}
                    className={cn(
                      'truncate rounded border px-1.5 py-0.5 text-[10px] font-medium',
                      STATUS_COLOR[a.effectiveStatus] ??
                        'border-slate-200 bg-slate-50 text-slate-700',
                    )}
                  >
                    {format(new Date(a.appointmentAt), 'HH:mm', { locale: ptBR })}{' '}
                    · {a.patientLabel}
                  </Link>
                ))}
                {overflow > 0 ? (
                  <Link
                    href={`/operacao/atendimentos?view=dia&date=${iso}`}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-200"
                  >
                    +{overflow} mais
                  </Link>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
