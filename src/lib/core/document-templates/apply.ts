import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'
import { getPatient } from '@/lib/core/patients/get'
import { getTemplate, type TemplateDocType, type PaperSize } from './crud'
import { substitutePlaceholders } from './placeholders'

export interface AppliedTemplate {
  title: string
  docType: TemplateDocType
  body: string
  paperSize: PaperSize
  fontSize: number
}

function ageFromBirth(birth: string | null): string {
  if (!birth) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birth)
  if (!m) return ''
  const b = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(b.getTime())) return ''
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  const md = now.getMonth() - b.getMonth()
  if (md < 0 || (md === 0 && now.getDate() < b.getDate())) age--
  return age >= 0 ? String(age) : ''
}

function ddmmyyyy(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/**
 * Backlog 3 — resolve um modelo para um paciente: substitui os placeholders
 * pelos dados reais (PII decifrada server-side). Devolve o corpo pronto p/ o
 * usuário revisar/editar antes de emitir.
 */
export async function applyTemplateToPatient(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; templateId: string; patientId: string },
): Promise<AppliedTemplate> {
  const tpl = await getTemplate(supabase, { tenantId: args.tenantId, id: args.templateId })
  if (!tpl) throw new NotFoundError('document_template', args.templateId)

  const { patient } = await getPatient(supabase, {
    tenantId: args.tenantId,
    patientId: args.patientId,
  })

  const tenantRes = await supabase
    .from('tenants')
    .select('name')
    .eq('id', args.tenantId)
    .maybeSingle()
  const clinicName = (tenantRes.data as { name?: string } | null)?.name ?? ''

  const vars: Record<string, string> = {
    'paciente.nome': patient.fullName || '',
    'paciente.cpf': patient.cpf || '',
    'paciente.nascimento': ddmmyyyy(patient.birthDate),
    'paciente.idade': ageFromBirth(patient.birthDate),
    'paciente.email': patient.email || '',
    'paciente.telefone': patient.phone || '',
    'clinica.nome': clinicName,
    data: new Date().toLocaleDateString('pt-BR'),
  }

  return {
    title: tpl.name,
    docType: tpl.docType,
    body: substitutePlaceholders(tpl.body, vars),
    paperSize: tpl.paperSize,
    fontSize: tpl.fontSize,
  }
}
