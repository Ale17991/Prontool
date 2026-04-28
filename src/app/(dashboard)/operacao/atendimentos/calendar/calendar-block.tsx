'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AppointmentWeekRow } from '@/lib/core/appointments/list-week'
import type { LaneAssignment } from '@/lib/utils/calendar'
import { slotForAppointment } from '@/lib/utils/calendar'

interface Props {
  assignment: LaneAssignment<{
    id: string
    start: Date
    end: Date
    appointment: AppointmentWeekRow
  }>
}

/**
 * Bloco individual de atendimento no calendario. Cor por status:
 *   - ativo     -> azul
 *   - estornado -> vermelho
 *   - concluido -> verde (mapeamento futuro; hoje cai em ativo)
 */
export function CalendarBlock({ assignment }: Props) {
  const a = assignment.block.appointment
  const pos = slotForAppointment(assignment.block.start, a.durationMinutes)
  if (pos.outOfBounds) return null

  const widthPercent = 100 / assignment.totalLanes
  const leftPercent = assignment.lane * widthPercent

  const statusClass =
    a.effectiveStatus === 'estornado'
      ? 'bg-rose-100 border-rose-300 text-rose-900 hover:bg-rose-200'
      : a.effectiveStatus === 'agendado'
        ? 'bg-sky-50 border-sky-200 text-sky-900 hover:bg-sky-100'
        : 'bg-blue-100 border-blue-300 text-blue-900 hover:bg-blue-200'

  return (
    <Link
      href={`/operacao/atendimentos/${a.id}`}
      className={cn(
        'absolute z-10 flex flex-col gap-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] shadow-sm transition-colors',
        statusClass,
        // US4 — defesa em profundidade contra dado conflitante.
        assignment.conflict && 'ring-2 ring-rose-500 ring-offset-1',
      )}
      style={{
        top: `${pos.topRem}rem`,
        height: `${pos.heightRem}rem`,
        left: `calc(${leftPercent}% + 2px)`,
        width: `calc(${widthPercent}% - 4px)`,
      }}
      title={
        assignment.conflict
          ? `Conflito detectado · ${a.patientName} · ${a.procedureLabel}`
          : `${a.patientName} · ${a.procedureLabel}`
      }
    >
      {assignment.conflict ? (
        <span className="absolute right-0.5 top-0.5">
          <AlertTriangle className="h-3 w-3 text-rose-600" />
        </span>
      ) : null}
      <span className="truncate font-bold leading-tight">
        {a.patientName}
        {a.planId === null ? (
          <span className="ml-1 inline-block rounded border border-amber-300 bg-amber-100 px-1 text-[8px] font-bold uppercase tracking-wider text-amber-900">
            P
          </span>
        ) : null}
      </span>
      <span className="truncate leading-tight opacity-80">{a.procedureLabel}</span>
    </Link>
  )
}
