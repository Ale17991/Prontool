/**
 * Feature 018 — Opt-in/Opt-out de lembretes por paciente (US4).
 *
 * Apenas operações na coluna `patients.reminders_opt_in`. Audit já é
 * automático pelo trigger existente em `patients` (features 001/002).
 *
 * Constituição III: filtro EXPLÍCITO por tenant_id (defense in depth)
 * mesmo quando o client RLS já bloqueia cross-tenant.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export async function getPatientOptIn(
  supabase: SupabaseClient<Database>,
  patientId: string,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('patients')
    .select('reminders_opt_in')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    throw new Error(`getPatientOptIn failed: ${error.message}`)
  }
  // Default TRUE quando coluna ainda não migrada ou paciente sem flag definida
  const row = data as { reminders_opt_in: boolean | null } | null
  return row?.reminders_opt_in !== false
}

export async function setPatientOptIn(
  supabase: SupabaseClient<Database>,
  patientId: string,
  tenantId: string,
  optIn: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('patients')
    .update({ reminders_opt_in: optIn } as never)
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
  if (error) {
    throw new Error(`setPatientOptIn failed: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Feature 051 — consentimento POR CANAL (FR-016)
//
// `reminders_opt_in` continua sendo o MESTRE: FALSE nele cala todos os canais.
// `reminders_whatsapp_opt_in` só é consultado quando o mestre é TRUE — recusar
// WhatsApp não pode, sozinho, cancelar o e-mail. Em LGPD isso importa: são
// consentimentos distintos, e tratá-los como um só é assumir permissão que o
// paciente não deu (ou remover uma que ele deu).
// ---------------------------------------------------------------------------

export interface PatientReminderConsent {
  /** Mestre — FALSE cala todos os canais. */
  optIn: boolean
  /** Específico do WhatsApp. Só tem efeito quando o mestre é TRUE. */
  whatsappOptIn: boolean
}

export async function getPatientConsent(
  supabase: SupabaseClient<Database>,
  patientId: string,
  tenantId: string,
): Promise<PatientReminderConsent> {
  const { data, error } = await supabase
    .from('patients')
    .select('reminders_opt_in, reminders_whatsapp_opt_in')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`getPatientConsent failed: ${error.message}`)

  const row = data as {
    reminders_opt_in: boolean | null
    reminders_whatsapp_opt_in: boolean | null
  } | null
  // Default TRUE nos dois: ausência de registro é "nunca disse não", não
  // "recusou". Espelha o default da coluna.
  return {
    optIn: row?.reminders_opt_in !== false,
    whatsappOptIn: row?.reminders_whatsapp_opt_in !== false,
  }
}

/** Recusa (ou volta a aceitar) APENAS o canal WhatsApp. */
export async function setPatientWhatsAppOptIn(
  supabase: SupabaseClient<Database>,
  patientId: string,
  tenantId: string,
  optIn: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('patients')
    .update({ reminders_whatsapp_opt_in: optIn } as never)
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
  if (error) {
    throw new Error(`setPatientWhatsAppOptIn failed: ${error.message}`)
  }
}

/**
 * Feature 056 — consentimento para mensagens de AUTOMAÇÃO.
 *
 * Vive aqui, junto dos outros opt-ins, porque a hierarquia é a mesma: o mestre
 * (`reminders_opt_in`) cala tudo, e este só é consultado quando o mestre está
 * ligado. Mas é manifestação DISTINTA — lembrete de consulta é comunicação
 * esperada de quem marcou hora; automação é conteúdo não solicitado, outra
 * finalidade em LGPD. Por isso nasce FALSE, ao contrário dos demais.
 */
export async function setPatientAutomationsOptIn(
  supabase: SupabaseClient<Database>,
  patientId: string,
  tenantId: string,
  optIn: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('patients')
    .update({ automations_opt_in: optIn } as never)
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
  if (error) {
    throw new Error(`setPatientAutomationsOptIn failed: ${error.message}`)
  }
}
