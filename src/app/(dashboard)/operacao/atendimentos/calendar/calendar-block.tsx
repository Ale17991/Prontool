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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  assignment: LaneAssignment<{
    id: string
    start: Date
    end: Date
    appointment: AppointmentWeekRow
  }>
  /** Atendimento sobrepoe um schedule_block — destaque amarelo (warning). */
  overlapsBlock?: boolean
  /** Intervalo (minutos) que cada linha representa — escala a posição/altura. */
  intervalMinutes?: number
}

/**
 * Bloco individual de atendimento no calendario. Cor + icone + label
 * provenientes do design system 016 (AppointmentStatusBadge variants):
 * o bloco inteiro reflete o status via paleta hibrida do designer.
 *
 * Hover: tooltip rico (nome + procedimento + horario + medico) e o bloco
 * expande para a largura total da coluna para acomodar varios atendimentos
 * empilhados no mesmo horario (cluster com lanes estreitas).
 */
export function CalendarBlock({ assignment, overlapsBlock = false, intervalMinutes }: Props) {
  const a = assignment.block.appointment
  const pos = slotForAppointment(assignment.block.start, a.durationMinutes, intervalMinutes)
  if (pos.outOfBounds) return null

  const widthPercent = 100 / assignment.totalLanes
  const leftPercent = assignment.lane * widthPercent

  const variant = effectiveStatusToVariant(a.effectiveStatus)
  const { className: statusClass, Icon: StatusIcon, label: statusLabel, style: statusStyle } =
    APPOINTMENT_STATUS_STYLES[variant]

  const startTime = formatHHmm(assignment.block.start)
  const endTime = formatHHmm(assignment.block.end)

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <Link
          href={`/operacao/atendimentos/${a.id}`}
          data-appointment-id={a.id}
          className={cn(
            'absolute z-10 flex flex-col gap-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-[11px] shadow-sm transition-[left,width,box-shadow,z-index]',
            statusClass,
            // US4 — defesa em profundidade contra dado conflitante.
            assignment.conflict && 'ring-2 ring-rose-500 ring-offset-1',
            // Schedule block overlap — warning amarelo, nao bloqueia.
            overlapsBlock && 'ring-2 ring-amber-500 ring-offset-1',
            // Hover: expande para largura total da coluna e sobe z-index, para
            // revelar o conteudo de blocos estreitos em clusters lotados. `!`
            // garante override do inline style de lane.
            assignment.totalLanes > 1 &&
              'hover:!left-[2px] hover:!w-[calc(100%-4px)] hover:z-30 hover:shadow-lg',
          )}
          style={{
            top: `${pos.topRem}rem`,
            height: `${pos.heightRem}rem`,
            left: `calc(${leftPercent}% + 2px)`,
            width: `calc(${widthPercent}% - 4px)`,
            ...statusStyle,
          }}
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
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="space-y-1">
        <div className="flex items-center gap-1.5 font-semibold text-slate-900">
          <StatusIcon className="h-3 w-3 opacity-70" />
          <span>{a.patientName}</span>
          {a.planId === null ? (
            <span className="rounded border border-warning/40 bg-[hsl(var(--warning)/0.2)] px-1 text-[9px] font-bold uppercase tracking-wider text-[hsl(var(--warning-foreground))]">
              Particular
            </span>
          ) : null}
        </div>
        <div className="text-slate-700">{a.procedureLabel}</div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="tabular-nums">
            {startTime}–{endTime}
          </span>
          <span>·</span>
          <span>{a.doctorName}</span>
        </div>
        <div className="text-[11px] text-slate-500">Status: {statusLabel}</div>
        {a.assistantsCount > 0 ? (
          <div className="text-[11px] text-slate-500">
            + {a.assistantsCount} assistente{a.assistantsCount === 1 ? '' : 's'}
          </div>
        ) : null}
        {assignment.conflict ? (
          <div className="flex items-center gap-1 text-[11px] font-semibold text-rose-600">
            <AlertTriangle className="h-3 w-3" />
            Conflito de horário
          </div>
        ) : null}
        {overlapsBlock ? (
          <div className="text-[11px] font-semibold text-amber-600">
            Sobrepõe bloqueio de agenda
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

function formatHHmm(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
