/**
 * Tipos compartilhados para bloqueios de agenda (schedule_blocks).
 * Migration 0083.
 */

export interface ScheduleBlockRow {
  id: string
  tenantId: string
  doctorId: string
  doctorName: string | null
  blockDate: string // YYYY-MM-DD
  startTime: string | null // HH:MM (sem segundos)
  endTime: string | null // HH:MM
  allDay: boolean
  reason: string
  createdBy: string
  createdAt: string
  deletedAt: string | null
  deletedBy: string | null
}

export interface CreateScheduleBlockInput {
  tenantId: string
  doctorId: string
  blockDate: string // YYYY-MM-DD
  allDay: boolean
  startTime?: string | null // HH:MM (obrigatorio se allDay=false)
  endTime?: string | null // HH:MM (obrigatorio se allDay=false)
  reason: string
  actorUserId: string
}

export interface ConflictWarning {
  appointmentId: string
  patientName: string
  appointmentAt: string
}

export interface CreateScheduleBlockResult {
  id: string
  conflicts: ConflictWarning[]
}
