/**
 * Leitura e escrita da configuração de campos dos impressos (0195).
 *
 * O guard lê a configuração no caminho de emissão; aqui ficam a leitura para a
 * tela e a gravação. Separado do guard de propósito: emitir documento é caminho
 * quente e não deve carregar código de escrita.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  DEFAULT_PRINTOUT_FIELDS,
  isPrintoutDocumentId,
  sanitizeFieldList,
  type PrintoutDocumentId,
  type PrintoutPatientField,
} from './fields'

export interface PrintoutConfig {
  fields: PrintoutPatientField[]
  overrides: Partial<Record<PrintoutDocumentId, PrintoutPatientField[]>>
}

export async function getPrintoutConfig(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<PrintoutConfig> {
  const { data, error } = await supabase
    .from('tenant_clinic_profile')
    .select('printout_patient_fields, printout_patient_field_overrides')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`getPrintoutConfig failed: ${error.message}`)

  const row = (data ?? null) as unknown as {
    printout_patient_fields: string[] | null
    printout_patient_field_overrides: Record<string, unknown> | null
  } | null

  // Clínica sem linha de perfil ainda não configurou nada — o padrão do
  // catálogo é a resposta certa, não um erro.
  if (!row) return { fields: [...DEFAULT_PRINTOUT_FIELDS], overrides: {} }

  const overrides: PrintoutConfig['overrides'] = {}
  for (const [doc, list] of Object.entries(row.printout_patient_field_overrides ?? {})) {
    if (isPrintoutDocumentId(doc)) overrides[doc] = sanitizeFieldList(list)
  }
  return { fields: sanitizeFieldList(row.printout_patient_fields ?? []), overrides }
}

export interface UpdatePrintoutConfigInput {
  tenantId: string
  fields: unknown
  /**
   * Mapa documento → lista. `null` no valor REMOVE a exceção e devolve o
   * documento ao padrão da clínica — é o "voltar ao padrão" da tela. Gravar
   * uma lista vazia é coisa diferente: significa "neste documento, só o nome".
   */
  overrides: unknown
  actorUserId: string
}

export async function updatePrintoutConfig(
  supabase: SupabaseClient<Database>,
  input: UpdatePrintoutConfigInput,
): Promise<PrintoutConfig> {
  const fields = sanitizeFieldList(input.fields)

  const overrides: Record<string, PrintoutPatientField[]> = {}
  if (input.overrides && typeof input.overrides === 'object') {
    for (const [doc, list] of Object.entries(input.overrides as Record<string, unknown>)) {
      if (!isPrintoutDocumentId(doc)) continue
      if (list === null) continue // voltar ao padrão: simplesmente não grava a chave
      overrides[doc] = sanitizeFieldList(list)
    }
  }

  const { error } = await supabase
    .from('tenant_clinic_profile')
    .update({
      printout_patient_fields: fields,
      printout_patient_field_overrides: overrides,
    } as never)
    .eq('tenant_id', input.tenantId)
  if (error) throw new Error(`updatePrintoutConfig failed: ${error.message}`)

  // Quem vê PII em papel é rastreado na emissão; quem MUDA o que sai em papel
  // precisa ser rastreado aqui — é a decisão que expõe (ou protege) o paciente
  // em todos os documentos seguintes.
  await supabase.rpc(
    'log_audit_event' as never,
    {
      p_tenant_id: input.tenantId,
      p_entity: 'tenant_clinic_profile',
      p_entity_id: input.tenantId,
      p_field: 'printout_patient_fields',
      p_old: null,
      p_new: JSON.stringify({ fields, overrides }),
      p_reason: 'campos do paciente nos impressos alterados',
    } as never,
  )

  return { fields, overrides: overrides as PrintoutConfig['overrides'] }
}
