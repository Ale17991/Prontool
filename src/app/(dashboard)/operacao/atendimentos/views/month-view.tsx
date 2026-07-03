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
import {
  APPOINTMENT_STATUS_STYLES,
  effectiveStatusToVariant,
} from '@/components/ui/appointment-status-badge'

/**
 * Feature 010 (US4 / R12) — visualização Mês.
 *
 * Grid 7×5–6. Cada célula:
 *   - cabeçalho com número do dia (vazio para dias fora do mês)
 *   - até 3 chips de atendimento (cor por status — design system 016)
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

export function MonthView({ date, appointments }: MonthViewProps) {
  const monthAnchor = startOfMonth(date)
  const gridStart = startOfWeek(monthAnchor, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 0 })

  const days: Date[] = []
  for (let cur = new Date(gridStart); cur <= gridEnd; cur.setDate(cur.getDate() + 1)) {
    days.push(new Date(cur))
  }

  // Agrupa atendimentos por dia LOCAL. `appointmentAt` vem em UTC ISO; slice(0,10)
  // pega a data UTC, que em fuso negativo (UTC-3) joga atendimentos noturnos
  // (>= 21:00 local) no dia seguinte do grid. Converter via Date e usar
  // getFullYear/Month/Date garante bucket no fuso da maquina (que casa com o
  // grid render, tambem montado por date-fns em fuso local).
  const byDay = new Map<string, MonthViewAppointment[]>()
  for (const a of appointments) {
    const key = format(new Date(a.appointmentAt), 'yyyy-MM-dd')
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
                <span
                  className={
                    isToday ? 'rounded-full bg-primary px-1.5 py-0.5 text-white' : 'text-slate-600'
                  }
                >
                  {d.getDate()}
                </span>
                {items.length > 0 ? (
                  <span className="text-[10px] text-slate-400">
                    {items.length} {items.length === 1 ? 'cons.' : 'cons.'}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1">
                {visible.map((a) => {
                  const variant = effectiveStatusToVariant(a.effectiveStatus)
                  const style = APPOINTMENT_STATUS_STYLES[variant]
                  const Icon = style.Icon
                  return (
                    <Link
                      key={a.id}
                      href={`/operacao/atendimentos/${a.id}`}
                      data-appointment-id={a.id}
                      className={cn(
                        'flex items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[10px] font-medium',
                        style.className,
                        // Chips de cancelado/estornado mantem strikethrough para reforco visual.
                        (variant === 'cancelado' || variant === 'estornado') && 'line-through',
                      )}
                      style={style.style}
                      title={`${a.patientLabel} · ${style.label}`}
                      aria-label={`${a.patientLabel}, ${style.label}`}
                    >
                      <Icon className="h-2.5 w-2.5 shrink-0 opacity-80" aria-hidden="true" />
                      <span className="truncate">
                        {format(new Date(a.appointmentAt), 'HH:mm', { locale: ptBR })} ·{' '}
                        {a.patientLabel}
                      </span>
                    </Link>
                  )
                })}
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
