import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { recordTissAudit } from './audit'
import { readCertificateInfo } from './signing/load-certificate'

/**
 * Feature 029 (US1) — persistência do certificado ICP-Brasil A1 por tenant.
 * `.pfx` (base64) e senha são cifrados via `enc_text_with_key` antes de gravar;
 * nunca retornados ao browser. No máximo 1 certificado ativo por tenant.
 */

async function encText(supabase: SupabaseClient<Database>, plain: string): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY not set')
  const { data, error } = await supabase.rpc('enc_text_with_key', { plain, key })
  if (error) throw new Error(`enc_text_with_key failed: ${error.message}`)
  return data as unknown as string
}

export interface UploadCertificateArgs {
  supabase: SupabaseClient<Database>
  tenantId: string
  /** Conteúdo do .pfx/.p12 em base64. */
  pfxBase64: string
  password: string
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export interface UploadedCertificate {
  id: string
  subjectCn: string
  notAfter: string
}

export async function uploadTissCertificate(
  args: UploadCertificateArgs,
): Promise<UploadedCertificate> {
  const { supabase, tenantId, pfxBase64, password } = args

  // Valida senha + formato e extrai metadados (lança TissInvalidCertificateError).
  const info = readCertificateInfo(pfxBase64, password)

  const [pfxEnc, passwordEnc] = await Promise.all([
    encText(supabase, pfxBase64),
    encText(supabase, password),
  ])

  // 1 ativo por tenant: desativa o anterior antes de inserir o novo.
  const { error: deErr } = await supabase
    .from('tenant_tiss_certificates')
    .update({ active: false })
    .eq('tenant_id', tenantId)
    .eq('active', true)
  if (deErr) throw new Error(`deactivate previous certificate failed: ${deErr.message}`)

  const { data, error } = await supabase
    .from('tenant_tiss_certificates')
    .insert({
      tenant_id: tenantId,
      pfx_enc: pfxEnc as unknown as string,
      password_enc: passwordEnc as unknown as string,
      subject_cn: info.subjectCn,
      not_after: info.notAfter.toISOString(),
      active: true,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (error) throw new Error(`uploadTissCertificate insert failed: ${error.message}`)

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'tenant_tiss_certificates',
    entityId: data.id,
    field: 'tiss.certificate.upload',
    detail: { subject_cn: info.subjectCn, not_after: info.notAfter.toISOString() },
    reason: 'admin subiu certificado ICP-Brasil A1 para faturamento TISS',
    ip: args.ip,
    userAgent: args.userAgent,
  })

  return { id: data.id, subjectCn: info.subjectCn, notAfter: info.notAfter.toISOString() }
}

/** Certificado ativo do tenant (metadados não-sensíveis). */
export async function getActiveTissCertificate(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ id: string; subject_cn: string; not_after: string } | null> {
  const { data, error } = await supabase
    .from('tenant_tiss_certificates')
    .select('id, subject_cn, not_after')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .maybeSingle()
  if (error) throw new Error(`getActiveTissCertificate failed: ${error.message}`)
  return data
}

export interface DeleteCertificateArgs {
  supabase: SupabaseClient<Database>
  tenantId: string
  certificateId: string
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export async function deleteTissCertificate(args: DeleteCertificateArgs): Promise<{ ok: true }> {
  const { supabase, tenantId, certificateId } = args
  const { error } = await supabase
    .from('tenant_tiss_certificates')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', certificateId)
  if (error) throw new Error(`deleteTissCertificate failed: ${error.message}`)

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'tenant_tiss_certificates',
    entityId: certificateId,
    field: 'tiss.certificate.delete',
    reason: 'admin removeu certificado ICP-Brasil',
    ip: args.ip,
    userAgent: args.userAgent,
  })
  return { ok: true }
}
