import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError } from '@/lib/observability/errors'

/**
 * Backlog 1/5 — bloqueia operações (agendar/atender) para paciente marcado
 * como óbito ou inativo. Lança DomainError PATIENT_INACTIVE quando status != ativo.
 */
export async function ensurePatientActive(
  supabase: SupabaseClient<Database>,
  patientId: string,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('patients')
    .select('status')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`ensurePatientActive failed: ${error.message}`)
  const status = (data as { status?: string } | null)?.status ?? 'ativo'
  if (status !== 'ativo') {
    throw new DomainError(
      'PATIENT_INACTIVE',
      status === 'obito'
        ? 'Paciente marcado como óbito — não é possível agendar ou atender.'
        : 'Paciente inativo — não é possível agendar ou atender.',
      { status: 400 },
    )
  }
}
