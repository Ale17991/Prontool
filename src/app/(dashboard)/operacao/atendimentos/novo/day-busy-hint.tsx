'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'

/**
 * Mostra os horários OCUPADOS do profissional no dia escolhido (atendimentos +
 * bloqueios, inclusive os do Google) para evitar conflito antes de marcar.
 * Busca /api/atendimentos/agenda-dia com debounce ao mudar profissional/data.
 */

interface DaySlot {
  kind: 'appointment' | 'block'
  startIso: string | null
  endIso: string | null
  startHm: string | null
  endHm: string | null
  allDay: boolean
  label: string
}

function hmFromIso(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Minuto do dia para ordenar (allDay = -1 vem primeiro). */
function sortKey(s: DaySlot): number {
  if (s.allDay) return -1
  const hm = s.startHm ?? (s.startIso ? hmFromIso(s.startIso) : '00:00')
  const [h, m] = hm.split(':')
  return Number(h) * 60 + Number(m)
}

export function DayBusyHint({ doctorId, dateLocal }: { doctorId: string; dateLocal: string }) {
  const [slots, setSlots] = useState<DaySlot[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) {
      setSlots(null)
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const start = new Date(`${dateLocal}T00:00`)
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
        const params = new URLSearchParams({
          doctor_id: doctorId,
          start: start.toISOString(),
          end: end.toISOString(),
          date: dateLocal,
        })
        const res = await fetch(`/api/atendimentos/agenda-dia?${params.toString()}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) {
          setSlots(null)
          return
        }
        const body = (await res.json()) as { slots: DaySlot[] }
        setSlots([...body.slots].sort((a, b) => sortKey(a) - sortKey(b)))
      } catch {
        // abort/rede — silencioso
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [doctorId, dateLocal])

  if (!doctorId) return null

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/50 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        <CalendarClock className="h-3.5 w-3.5 text-primary" />
        Horários ocupados neste dia
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-slate-400" /> : null}
      </p>
      {slots === null ? (
        <p className="text-xs text-slate-400">Selecione profissional e data.</p>
      ) : slots.length === 0 ? (
        <p className="text-xs text-success-strong">Nenhum horário ocupado — dia livre.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {slots.map((s, i) => {
            const range = s.allDay
              ? 'Dia inteiro'
              : s.kind === 'appointment'
                ? `${hmFromIso(s.startIso!)}–${hmFromIso(s.endIso!)}`
                : `${s.startHm}–${s.endHm}`
            const isBlock = s.kind === 'block'
            return (
              <span
                key={i}
                title={s.label}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums ${
                  isBlock
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {range}
                {isBlock ? <span className="font-normal opacity-70">· {s.label}</span> : null}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
