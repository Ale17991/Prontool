import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { createHash } from 'node:crypto'

/**
 * Feature 030 — trilha de acesso do paciente (FR-020, LGPD).
 *
 * Toda interação do paciente com o portal (login ok/falha, view) vira uma
 * linha append-only em `patient_portal_access_log`, escrita só pelo
 * service-role. IP NUNCA em claro — apenas hash escopado ao tenant
 * (mesma filosofia de `public-booking/ip-hash.ts`).
 */

export type PatientAccessAction = 'login_ok' | 'login_fail' | 'view' | 'habit_mark'

/** Hash de IP escopado ao tenant (defesa em profundidade — não vira ID global). */
export function hashIpForPatientPortal(ip: string, tenantId: string): string {
  return createHash('sha256').update(`${ip}:${tenantId}`).digest('hex')
}

export interface LogPatientAccessInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  /** NULL em falha de login (paciente não identificado). */
  patientId: string | null
  action: PatientAccessAction
  ipHash: string
  userAgent?: string | null
  /**
   * Feature 057 — qual área do portal foi aberta (`home`, `exames`, `dieta`…).
   *
   * Com o portal em várias páginas, uma visita virou cinco ou seis linhas. Sem
   * este campo seriam cinco `view` idênticos: mais volume carregando a mesma
   * informação. Ausente nas ações que não são navegação (login, marcação de
   * hábito) e nas linhas gravadas antes da 057 — `section IS NULL` é o que as
   * identifica, e elas NÃO são retroalimentadas.
   */
  section?: string | null
}

/** Best-effort: a trilha nunca derruba a request principal. */
export async function logPatientAccess(input: LogPatientAccessInput): Promise<void> {
  const { error } = await input.supabase.from('patient_portal_access_log').insert({
    tenant_id: input.tenantId,
    patient_id: input.patientId,
    action: input.action,
    ip_hash: input.ipHash,
    user_agent: input.userAgent?.slice(0, 512) ?? null,
    section: input.section ?? null,
  } as never)
  if (error) {
    // best-effort — sub-registro pontual é preferível a 500 no portal
  }
}
