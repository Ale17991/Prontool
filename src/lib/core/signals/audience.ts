/**
 * Feature 053 — quem a regra alcança.
 *
 * `patients` NÃO tem vínculo com profissional — verificado no schema. O público
 * "pacientes de um profissional" é derivado do profissional da **consulta mais
 * recente** do paciente (FR-003a).
 *
 * É a única leitura que continua válida para quem não retorna há meses, que é
 * justamente o público da regra de retorno vencido — e é o que a clínica quer
 * dizer com "meus pacientes": quem eu atendi por último, não quem passou por
 * mim uma vez há três anos.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { SignalAudience } from './types'

export interface ResolveAudienceInput {
  tenantId: string
  audience: SignalAudience
  audienceDoctorId: string | null
}

/**
 * Resolve UMA vez por ciclo, por clínica — não por paciente. A alternativa
 * (perguntar "de quem é este paciente?" para cada um) seria N+1 sobre a base
 * inteira, e a base inteira é exatamente o tamanho do problema aqui.
 */
export async function resolveAudience(
  supabase: SupabaseClient<Database>,
  input: ResolveAudienceInput,
): Promise<string[]> {
  const ativos = await supabase
    .from('patients')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('status', 'ativo')
  if (ativos.error) throw new Error(`resolveAudience failed: ${ativos.error.message}`)

  const todos = (ativos.data ?? []).map((r) => (r as { id: string }).id)
  if (input.audience === 'todos_ativos' || !input.audienceDoctorId) return todos

  const ultimoMedico = await lastDoctorByPatient(supabase, input.tenantId, todos)
  // Paciente sem nenhuma consulta não entra em público por profissional
  // (FR-003b): não há de quem ele seja. Ficar de fora é o certo — o contrário
  // seria atribuí-lo arbitrariamente a alguém.
  return todos.filter((id) => ultimoMedico.get(id) === input.audienceDoctorId)
}

async function lastDoctorByPatient(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (patientIds.length === 0) return out

  // Ordenado do mais recente para o mais antigo: a PRIMEIRA linha de cada
  // paciente é a consulta mais recente, e as seguintes são ignoradas. Faz o
  // papel do DISTINCT ON sem precisar de RPC.
  const { data, error } = await supabase
    .from('appointments')
    .select('patient_id, doctor_id, appointment_at')
    .eq('tenant_id', tenantId)
    .in('patient_id', patientIds)
    .not('doctor_id', 'is', null)
    .order('appointment_at', { ascending: false })
  if (error) throw new Error(`lastDoctorByPatient failed: ${error.message}`)

  for (const row of data ?? []) {
    const r = row as { patient_id: string; doctor_id: string | null }
    if (!r.doctor_id) continue
    if (!out.has(r.patient_id)) out.set(r.patient_id, r.doctor_id)
  }
  return out
}
