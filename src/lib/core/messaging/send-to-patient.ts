/**
 * Feature 053 — enviar mensagem a um paciente, sem consulta no caminho.
 *
 * A abstração que faltava no repo. Hoje quatro passos — resolver contato,
 * checar consentimento, escolher canal, registrar — estão duplicados
 * LITERALMENTE entre `reminders/send-one.ts` e `reminders/send-one-whatsapp.ts`,
 * ambos amarrados a `appointment_id`. Aqui eles existem uma vez só, e sem essa
 * amarra.
 *
 * Esta cápsula NÃO sabe o que é regra nem o que é sinal. Recebe paciente, texto
 * e finalidade; devolve desfecho classificado. É o que permitirá aos lembretes
 * migrarem para cá depois sem arrastar o motor de sinais junto — e é por isso
 * que ela vive em `messaging/` e não em `signals/`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { normalizePhone } from '@/lib/core/whatsapp/phone'
import { isWhatsAppConnected, getDecryptedApiKey } from '@/lib/core/whatsapp/config'
import { sendText } from '@/lib/core/whatsapp/service-client'
import { sendBookingEmail } from '@/lib/integrations/email/resend-client'
import { decideConsentAndChannel } from './consent'
import type {
  MessageChannel,
  SendToPatientInput,
  SendToPatientResult,
} from './types'

interface PatientContact {
  fullName: string | null
  phone: string | null
  email: string | null
  status: string | null
  outreachOptIn: boolean
  whatsappOptIn: boolean
}

export async function sendToPatient(
  supabase: SupabaseClient<Database>,
  input: SendToPatientInput,
): Promise<SendToPatientResult> {
  const contact = await loadContact(supabase, input.tenantId, input.patientId)
  if (!contact) return { ok: false, reason: 'sem_contato', detail: 'paciente-nao-encontrado' }

  // A conexão só é consultada quando o WhatsApp está em jogo — checar sempre
  // custaria uma ida ao banco por paciente numa clínica que só usa e-mail.
  const whatsappConnected =
    input.preference === 'email'
      ? false
      : await isWhatsAppConnected(supabase as never, input.tenantId).catch(() => false)

  const decision = decideConsentAndChannel({
    status: contact.status,
    outreachOptIn: contact.outreachOptIn,
    whatsappOptIn: contact.whatsappOptIn,
    phone: contact.phone,
    email: contact.email,
    preference: input.preference,
    whatsappConnected,
  })
  if (!decision.ok) return decision
  const channel = decision.channel

  const messageId = crypto.randomUUID()

  try {
    if (channel === 'whatsapp') {
      const apiKey = await getDecryptedApiKey(supabase as never, input.tenantId)
      if (!apiKey) return { ok: false, reason: 'canal_indisponivel', detail: 'sem-credencial' }

      const res = await sendText({
        apiKey,
        to: normalizePhone(contact.phone as string),
        message: input.body,
        // O id da mensagem é o externalId, e o serviço tem
        // UNIQUE (tenant_id, external_id): retentativa da fila não duplica
        // mensagem no celular do paciente. Idempotência ponta a ponta.
        externalId: messageId,
      })
      if (!res.ok) {
        await record(supabase, messageId, input, channel, 'failed', res.kind)
        return { ok: false, reason: 'falha_envio', detail: res.kind }
      }
    } else {
      await sendBookingEmail({
        tenantId: input.tenantId,
        to: contact.email as string,
        subject: input.subject ?? 'Mensagem da sua clínica',
        html: toHtml(input.body),
      })
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'erro-desconhecido'
    await record(supabase, messageId, input, channel, 'failed', detail)
    logger.error({ tenantId: input.tenantId, channel }, 'send-to-patient-failed')
    return { ok: false, reason: 'falha_envio', detail }
  }

  await record(supabase, messageId, input, channel, 'sent', null)
  return { ok: true, messageId, channel }
}

async function loadContact(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<PatientContact | null> {
  const flags = await supabase
    .from('patients')
    .select('status, outreach_opt_in, reminders_opt_in, reminders_whatsapp_opt_in')
    .eq('tenant_id', tenantId)
    .eq('id', patientId)
    .maybeSingle()
  if (flags.error || !flags.data) return null
  const f = flags.data as {
    status: string | null
    outreach_opt_in: boolean | null
    reminders_whatsapp_opt_in: boolean | null
  }

  // PII sai cifrada do banco e só é decifrada aqui, no instante do envio, via
  // RPC — nunca projetada numa query comum.
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) {
    logger.error({ tenantId }, 'send-to-patient-missing-encryption-key')
    return null
  }
  const dec = await supabase.rpc('get_patient_for_tenant', {
    p_tenant_id: tenantId,
    p_patient_id: patientId,
    p_key: key,
  })
  if (dec.error || !dec.data) return null
  const row = (Array.isArray(dec.data) ? dec.data[0] : dec.data) as {
    full_name: string | null
    phone: string | null
    email: string | null
  } | null
  if (!row) return null

  return {
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    status: f.status,
    outreachOptIn: f.outreach_opt_in === true,
    whatsappOptIn: f.reminders_whatsapp_opt_in !== false,
  }
}

/**
 * Grava o registro da comunicação. O `body` vai JÁ RENDERIZADO, como o paciente
 * leu: o template pode ser editado depois, e recompor a mensagem a partir dele
 * mostraria à clínica algo diferente do que foi entregue.
 */
async function record(
  supabase: SupabaseClient<Database>,
  id: string,
  input: SendToPatientInput,
  channel: MessageChannel,
  status: 'sent' | 'failed',
  errorDetail: string | null,
): Promise<void> {
  const { error } = await supabase.from('patient_messages').insert({
    id,
    tenant_id: input.tenantId,
    patient_id: input.patientId,
    purpose: input.purpose,
    channel,
    body: input.body,
    status,
    error_detail: errorDetail ? errorDetail.slice(0, 500) : null,
  } as never)
  if (error) {
    // Não derruba o envio: a mensagem já saiu, e perder o registro é ruim mas
    // não é motivo para a chamada inteira parecer ter falhado.
    logger.error({ tenantId: input.tenantId, status }, 'patient-message-record-failed')
  }
}

function toHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<p>${escaped.replace(/\n/g, '<br/>')}</p>`
}
