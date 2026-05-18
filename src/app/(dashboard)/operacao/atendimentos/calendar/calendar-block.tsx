'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AppointmentWeekRow } from '@/lib/core/appointments/list-week'
import type { LaneAssignment } from '@/lib/utils/calendar'
import { slotForAppointment } from '@/lib/utils/calendar'
import {
  APPOINTMENT_STATUS_STYLES,
  effectiveStatusToVariant,
} from '@/components/ui/appointment-status-badge'

interface Props {
  assignment: LaneAssignment<{
    id: string
    start: Date
    end: Date
    appointment: AppointmentWeekRow
  }>
  /** Atendimento sobrepoe um schedule_block — destaque amarelo (warning). */
  overlapsBlock?: boolean
}

/**
 * Bloco individual de atendimento no calendario. Cor + icone + label
 * provenientes do design system 016 (AppointmentStatusBadge variants):
 * o bloco inteiro reflete o status via paleta hibrida do designer.
 */
export function CalendarBlock({ assignment, overlapsBlock = false }: Props) {
  const a = assignment.block.appointment
  const pos = slotForAppointment(assignment.block.start, a.durationMinutes)
  if (pos.outOfBounds) return null

  const widthPercent = 100 / assignment.totalLanes
  const leftPercent = assignment.lane * widthPercent

  const variant = effectiveStatusToVariant(a.effectiveStatus)
  const { className: statusClass, Icon: StatusIcon, label: statusLabel, style: statusStyle } =
    APPOINTMENT_STATUS_STYLES[variant]

  return (
    <Link
      href={`/operacao/atendimentos/${a.id}`}
      className={cn(
        'absolute z-10 flex flex-col gap-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] shadow-sm transition-colors',
        statusClass,
        // US4 — defesa em profundidade contra dado conflitante.
        assignment.conflict && 'ring-2 ring-rose-500 ring-offset-1',
        // Schedule block overlap — warning amarelo, nao bloqueia.
        overlapsBlock && 'ring-2 ring-amber-500 ring-offset-1',
      )}
      style={{
        top: `${pos.topRem}rem`,
        height: `${pos.heightRem}rem`,
        left: `calc(${leftPercent}% + 2px)`,
        width: `calc(${widthPercent}% - 4px)`,
        ...statusStyle,
      }}
      title={
        assignment.conflict
          ? `Conflito detectado · ${a.patientName} · ${a.procedureLabel} · ${statusLabel}`
          : `${a.patientName} · ${a.procedureLabel} · ${statusLabel}`
      }
      aria-label={`${a.patientName}, ${a.procedureLabel}, ${statusLabel}`}
    >
      <span aria-hidden="true" className="absolute left-0.5 top-0.5">
        <StatusIcon className="h-2.5 w-2.5 opacity-80" />
      </span>
      {assignment.conflict ? (
        <span className="absolute right-0.5 top-0.5">
          <AlertTriangle className="h-3 w-3 text-destructive" />
        </span>
      ) : null}
      <span className="truncate font-bold leading-tight">
        {a.patientName}
        {a.planId === null ? (
          <span className="ml-1 inline-block rounded border border-warning/40 bg-[hsl(var(--warning)/0.2)] px-1 text-[8px] font-bold uppercase tracking-wider text-[hsl(var(--warning-foreground))]">
            P
          </span>
        ) : null}
      </span>
      <span className="truncate leading-tight opacity-80">{a.procedureLabel}</span>
      {a.assistantsCount > 0 ? (
        <span className="truncate text-[9px] font-semibold leading-tight opacity-70">
          (+ {a.assistantsCount} assistente{a.assistantsCount === 1 ? '' : 's'})
        </span>
      ) : null}
    </Link>
  )
}
