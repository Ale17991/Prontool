import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'

export type FlowStatus = 'agendado' | 'aguardando' | 'em_consulta' | 'atendido' | 'desmarcou'

export const FLOW_STATUSES: FlowStatus[] = [
  'agendado',
  'aguardando',
  'em_consulta',
  'atendido',
  'desmarcou',
]

export interface AppointmentFlow {
  status: FlowStatus
  arrivedAt: string | null
  consultStartedAt: string | null
  endedAt: string | null
  updatedAt: string | null
}

const SELECT = 'appointment_id, status, arrived_at, consult_started_at, ended_at, updated_at'

const DEFAULT_FLOW: AppointmentFlow = {
  status: 'agendado',
  arrivedAt: null,
  consultStartedAt: null,
  endedAt: null,
  updatedAt: null,
}

function toDto(r: Record<string, unknown>): AppointmentFlow {
  return {
    status: (r.status as FlowStatus) ?? 'agendado',
    arrivedAt: (r.arrived_at as string | null) ?? null,
    consultStartedAt: (r.consult_started_at as string | null) ?? null,
    endedAt: (r.ended_at as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  }
}

/** Fluxo atual de um atendimento (default 'agendado' se ainda não há linha). */
export async function getAppointmentFlow(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; appointmentId: string },
): Promise<AppointmentFlow> {
  const { data, error } = await supabase
    .from('appointment_flow' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .eq('appointment_id', args.appointmentId)
    .maybeSingle()
  if (error) throw new Error(`getAppointmentFlow failed: ${error.message}`)
  return data ? toDto(data as unknown as Record<string, unknown>) : { ...DEFAULT_FLOW }
}

/** Fluxo de vários atendimentos (mapa appointment_id -> flow) para a agenda. */
export async function listAppointmentFlows(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; appointmentIds: string[] },
): Promise<Map<string, AppointmentFlow>> {
  const map = new Map<string, AppointmentFlow>()
  if (args.appointmentIds.length === 0) return map
  const { data, error } = await supabase
    .from('appointment_flow' as never)
    .select(SELECT)
    .eq('tenant_id', args.tenantId)
    .in('appointment_id', args.appointmentIds)
  if (error) throw new Error(`listAppointmentFlows failed: ${error.message}`)
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    map.set(row.appointment_id as string, toDto(row))
  }
  return map
}

/**
 * Define o status do fluxo (upsert) e carimba os timestamps de chegada/permanência
 * conforme a transição. Registra a mudança no audit_log.
 */
export async function setAppointmentFlowStatus(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; appointmentId: string; status: FlowStatus; actorUserId: string },
): Promise<AppointmentFlow> {
  if (!FLOW_STATUSES.includes(args.status)) throw new ValidationError('Status de fluxo inválido.')

  const existing = await getAppointmentFlow(supabase, {
    tenantId: args.tenantId,
    appointmentId: args.appointmentId,
  })
  const now = new Date().toISOString()
  const arrivalStates: FlowStatus[] = ['aguardando', 'em_consulta', 'atendido']
  const consultStates: FlowStatus[] = ['em_consulta', 'atendido']
  const endStates: FlowStatus[] = ['atendido', 'desmarcou']

  // Chegada/início são "primeiro carimbo" (não sobrescreve um já registrado).
  const arrivedAt = existing.arrivedAt ?? (arrivalStates.includes(args.status) ? now : null)
  const consultStartedAt =
    existing.consultStartedAt ?? (consultStates.includes(args.status) ? now : null)
  // Saída: carimba ao entrar em estado terminal; limpa ao sair dele (correção).
  const endedAt = endStates.includes(args.status) ? (existing.endedAt ?? now) : null

  const { error } = await supabase.from('appointment_flow' as never).upsert(
    {
      tenant_id: args.tenantId,
      appointment_id: args.appointmentId,
      status: args.status,
      arrived_at: arrivedAt,
      consult_started_at: consultStartedAt,
      ended_at: endedAt,
      updated_by: args.actorUserId,
      updated_at: now,
    } as never,
    { onConflict: 'tenant_id,appointment_id' } as never,
  )
  if (error) throw new Error(`setAppointmentFlowStatus failed: ${error.message}`)

  await supabase.from('audit_log').insert({
    tenant_id: args.tenantId,
    actor_id: args.actorUserId,
    actor_label: null,
    entity: 'appointment_flow',
    entity_id: args.appointmentId,
    field: 'status',
    old_value: existing.status,
    new_value: args.status,
    reason: 'fluxo do atendimento via /api/atendimentos/[id]/fluxo POST',
    result: 'success',
  } as never)

  return { status: args.status, arrivedAt, consultStartedAt, endedAt, updatedAt: now }
}
