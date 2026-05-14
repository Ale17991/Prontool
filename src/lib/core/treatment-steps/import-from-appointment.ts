import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'

/**
 * Cria uma `treatment_plan_steps` a partir de um atendimento existente
 * que ainda nao tem etapa vinculada (orfao). Usado pelo botao "Adicionar
 * ao plano" no historico do paciente.
 *
 * Por que INSERT em vez de UPDATE de etapa existente:
 *   - O index UNIQUE em treatment_plan_steps_appointment_idx ja garante
 *     que so uma step pode apontar para o mesmo appointment_id.
 *   - Etapas legadas (sem appointment_id) que poderiam ser linkadas via
 *     UPDATE precisariam de logica de match — o user disse explicitamente
 *     que NAO existe step compativel (auto-link nao encontrou). Entao a
 *     unica saida e criar nova step ja vinculada.
 *
 * Status da step derivado do effective_status do atendimento:
 *   - 'ativo'      → step 'concluido' com completed_at = appointment_at
 *   - 'agendado'   → step 'pendente'
 *   - 'estornado'  → rejeita (DomainError APPOINTMENT_REVERSED) — nao faz
 *                    sentido criar step para atendimento cancelado.
 *
 * Multi-procedimento: o appointment pode ter N linhas em
 * appointment_procedures. Usamos a linha primaria (sequence=1, igual a
 * appointments.procedure_id/plan_id), alinhado ao schema 1:N do
 * treatment_plan_steps (uma step → um procedimento).
 */
export interface ImportAppointmentToPlanInput {
  tenantId: string
  patientId: string
  appointmentId: string
  actorUserId: string
}

export interface ImportAppointmentToPlanResult {
  stepId: string
  appointmentId: string
  status: 'pendente' | 'concluido'
}

export async function importAppointmentToPlan(
  supabase: SupabaseClient<Database>,
  input: ImportAppointmentToPlanInput,
): Promise<ImportAppointmentToPlanResult> {
  // 1) Le o atendimento + effective_status. Filtra por tenant + patient para
  //    evitar cross-tenant ou trocar de paciente.
  const apptRes = await supabase
    .from('appointments_effective')
    .select(
      'id, tenant_id, patient_id, doctor_id, procedure_id, plan_id, appointment_at, effective_status',
    )
    .eq('tenant_id', input.tenantId)
    .eq('patient_id', input.patientId)
    .eq('id', input.appointmentId)
    .maybeSingle()
  if (apptRes.error) {
    throw new Error(`importAppointmentToPlan: ${apptRes.error.message}`)
  }
  if (!apptRes.data) {
    throw new NotFoundError('appointment', input.appointmentId)
  }
  const appt = apptRes.data as {
    id: string
    doctor_id: string
    procedure_id: string
    plan_id: string | null
    appointment_at: string
    effective_status: string | null
  }

  if (appt.effective_status === 'estornado') {
    throw new DomainError(
      'APPOINTMENT_REVERSED',
      'Atendimento estornado não pode ser adicionado ao plano de tratamento.',
      { status: 400 },
    )
  }

  // 2) Verifica que nao existe step ja vinculada a este appointment.
  //    O UNIQUE index pegaria isso no INSERT, mas verificar antes da uma
  //    mensagem mais clara.
  const existing = await supabase
    .from('treatment_plan_steps')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('appointment_id', input.appointmentId)
    .maybeSingle()
  if (existing.error) {
    throw new Error(`importAppointmentToPlan check: ${existing.error.message}`)
  }
  if (existing.data) {
    throw new DomainError(
      'APPOINTMENT_ALREADY_IN_PLAN',
      'Este atendimento já está vinculado a uma etapa do plano de tratamento.',
      { status: 409 },
    )
  }

  // 3) INSERT. Status derivado do atendimento; titulo descritivo padrao.
  const isCompleted = appt.effective_status === 'ativo'
  const scheduledDate = appt.appointment_at.slice(0, 10) // YYYY-MM-DD em UTC
  const title = isCompleted
    ? 'Atendimento concluído (importado)'
    : 'Atendimento agendado (importado)'

  const insertPayload: Database['public']['Tables']['treatment_plan_steps']['Insert'] = {
    tenant_id: input.tenantId,
    patient_id: input.patientId,
    procedure_id: appt.procedure_id,
    plan_id: appt.plan_id,
    doctor_id: appt.doctor_id,
    title,
    notes: null,
    scheduled_date: scheduledDate,
    status: isCompleted ? 'concluido' : 'pendente',
    completed_at: isCompleted ? appt.appointment_at : null,
    completed_by: isCompleted ? input.actorUserId : null,
    appointment_id: input.appointmentId,
    created_by: input.actorUserId,
  }

  const ins = await supabase
    .from('treatment_plan_steps')
    .insert(insertPayload)
    .select('id')
    .single()
  if (ins.error || !ins.data) {
    // O UNIQUE index pode quebrar aqui se outra request inseriu no meio.
    if (ins.error?.code === '23505') {
      throw new DomainError(
        'APPOINTMENT_ALREADY_IN_PLAN',
        'Este atendimento já foi adicionado ao plano por outra operação.',
        { status: 409 },
      )
    }
    throw new Error(`importAppointmentToPlan insert: ${ins.error?.message ?? 'unknown'}`)
  }

  return {
    stepId: ins.data.id,
    appointmentId: input.appointmentId,
    status: isCompleted ? 'concluido' : 'pendente',
  }
}
