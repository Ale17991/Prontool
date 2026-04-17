import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError } from '@/lib/observability/errors'

/**
 * Anonymização LGPD do paciente. Marca `patients.anonymized_at`,
 * substitui as colunas BYTEA criptografadas por placeholders, e nos
 * registros clínicos:
 *   - tipo `texto`: zera o `content`
 *   - tipo `arquivo`: remove o objeto do bucket, troca `file_url`,
 *     `file_name` e `file_size_bytes` por placeholders
 *
 * Soft-deletados continuam soft-deletados; ainda assim limpamos o
 * conteúdo PII pra cumprir o "right to erasure". O id da linha é
 * preservado (linkagem com `appointments.patient_id`, mas nome/CPF
 * desaparecem).
 *
 * Idempotente: chamar duas vezes devolve `ConflictError` para que a
 * trilha de auditoria não registre múltiplos eventos sem motivo.
 *
 * Esta operação é IRREVERSÍVEL.
 */
export interface AnonymizePatientInput {
  tenantId: string
  patientId: string
  actorUserId: string
  reason: string
}

export interface AnonymizeResult {
  patientId: string
  anonymizedAt: string
  recordsAnonymized: number
  filesRemoved: number
}

const PLACEHOLDER_TEXT = '[anonimizado]'
const PLACEHOLDER_FILE_NAME = '[arquivo-removido]'

export async function anonymizePatient(
  supabase: SupabaseClient<Database>,
  input: AnonymizePatientInput,
): Promise<AnonymizeResult> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY required for anonymization')

  const patient = await supabase
    .from('patients')
    .select('id, anonymized_at')
    .eq('id', input.patientId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (patient.error) throw new Error(`patient lookup failed: ${patient.error.message}`)
  if (!patient.data) throw new NotFoundError('patient', input.patientId)
  if (patient.data.anonymized_at) {
    throw new ConflictError(
      'PATIENT_ALREADY_ANONYMIZED',
      'Paciente já foi anonimizado anteriormente',
      { anonymized_at: patient.data.anonymized_at },
    )
  }

  // 1. Encripta o placeholder pra todas as colunas PII.
  const { data: encPlaceholder, error: encErr } = await supabase.rpc('enc_text_with_key', {
    plain: PLACEHOLDER_TEXT,
    key,
  })
  if (encErr || !encPlaceholder) throw new Error(`enc_text_with_key failed: ${encErr?.message}`)
  const placeholderEnc = encPlaceholder as unknown as string

  const anonymizedAt = new Date().toISOString()

  // 2. Atualiza patients.
  const { error: updErr } = await supabase
    .from('patients')
    .update({
      full_name_enc: placeholderEnc,
      cpf_enc: placeholderEnc,
      phone_enc: null,
      email_enc: null,
      birth_date_enc: null,
      anonymized_at: anonymizedAt,
    })
    .eq('id', input.patientId)
    .eq('tenant_id', input.tenantId)
  if (updErr) throw new Error(`patient anonymize update failed: ${updErr.message}`)

  // 3. Anonymiza clinical_records (PII em conteúdo + remoção de arquivos).
  const records = await supabase
    .from('clinical_records')
    .select('id, type, file_url')
    .eq('tenant_id', input.tenantId)
    .eq('patient_id', input.patientId)
  if (records.error) throw new Error(`clinical_records list failed: ${records.error.message}`)

  let filesRemoved = 0
  const filesToRemove = (records.data ?? [])
    .filter((r): r is typeof r & { file_url: string } => r.type === 'arquivo' && !!r.file_url)
    .map((r) => r.file_url)

  if (filesToRemove.length > 0) {
    const remove = await supabase.storage.from('clinical-files').remove(filesToRemove)
    if (remove.error) {
      // Não falha tudo; loga via outer handler. O update da DB ainda
      // ocorre pra remover o link, e o arquivo no storage pode ser
      // limpo manualmente depois.
      console.error('[anonymize] storage.remove parcial:', remove.error.message)
    } else {
      filesRemoved = remove.data?.length ?? 0
    }
  }

  let recordsAnonymized = 0
  for (const r of records.data ?? []) {
    const update =
      r.type === 'texto'
        ? { content: PLACEHOLDER_TEXT }
        : {
            file_name: PLACEHOLDER_FILE_NAME,
            file_url: PLACEHOLDER_FILE_NAME,
            file_size_bytes: 0,
          }
    const { error: recErr } = await supabase
      .from('clinical_records')
      .update(update)
      .eq('id', r.id)
      .eq('tenant_id', input.tenantId)
    if (recErr) {
      console.error(`[anonymize] record ${r.id} update failed: ${recErr.message}`)
      continue
    }
    recordsAnonymized += 1
  }

  // 4. Trilha explícita do motivo + ator (audit_log captura o resto via
  //    triggers mas o motivo precisa ser registrado).
  const { error: auditErr } = await supabase.from('audit_log').insert({
    tenant_id: input.tenantId,
    actor_id: input.actorUserId,
    actor_label: `user:${input.actorUserId}`,
    entity: 'patients',
    entity_id: input.patientId,
    field: 'anonymized_at',
    old_value: null,
    new_value: anonymizedAt,
    reason: input.reason,
    result: 'success',
  })
  if (auditErr) console.error(`[anonymize] audit insert failed: ${auditErr.message}`)

  return {
    patientId: input.patientId,
    anonymizedAt,
    recordsAnonymized,
    filesRemoved,
  }
}
