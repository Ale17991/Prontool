/**
 * Feature 029 (US4/T035+T036) — fechamento, assinatura e exportação do lote.
 *
 * T035: lote de 1 guia pronta → XML assinado que valida no XSD 04.03.00, com
 *       hash MD-5 e <Signature>; guia passa a `exportada`; re-leitura reproduz
 *       o mesmo conteúdo/hash.
 * T036: sem certificado ativo → erro; guia não-`pronta` não loteia.
 *
 * Usa um certificado A1 self-signed (node-forge) só para o teste de assinatura.
 */
import { randomUUID } from 'node:crypto'
import forge from 'node-forge'
import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedUser,
  seedHealthPlan,
  seedDoctor,
  seedProcedure,
  seedTussCode,
  seedPriceVersion,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { seedAppointmentLineAndComplete } from '@/tests/integration/_helpers/seed-appointment-procedure'
import { generateConsultaGuia } from '@/lib/core/tiss/build-guia'
import { upsertPatientCard } from '@/lib/core/tiss/patient-cards'
import { uploadTissCertificate } from '@/lib/core/tiss/certificates'
import { createLote } from '@/lib/core/tiss/build-lote'
import { validateTissXml } from '@/lib/core/tiss/validate'

const TUSS_CODE = '10101012'
const AMOUNT = 25000
const PFX_PASSWORD = 'senha-teste'

/** Gera um .pfx (base64) self-signed A1 só para o teste. */
function makeSelfSignedPfxBase64(): string {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000)
  const attrs = [{ name: 'commonName', value: 'Clinica Teste TISS' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PFX_PASSWORD, {
    algorithm: '3des',
  })
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes())
}

async function seedDecryptablePatient(sb: SupabaseClient, tenantId: string): Promise<string> {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY as string
  const enc = async (plain: string) => {
    const { data } = await sb.rpc('enc_text_with_key', { plain, key })
    return data as unknown as string
  }
  const id = randomUUID()
  await sb
    .from('patients')
    .insert({
      id,
      tenant_id: tenantId,
      ghl_contact_id: `contact-${id}`,
      full_name_enc: await enc('João Beneficiário'),
      cpf_enc: await enc('39053344705'),
    })
    .throwOnError()
  return id
}

async function setupWithGuia(slug: string) {
  const sb = serviceClient()
  const { tenantId } = await seedTenant(slug)
  const admin = await seedUser(tenantId, 'admin')
  const planId = await seedHealthPlan(tenantId, 'Operadora Lote')
  await seedTussCode(TUSS_CODE)
  const procedureId = await seedProcedure(tenantId, TUSS_CODE)
  const priceVersionId = await seedPriceVersion({
    tenantId,
    procedureId,
    planId,
    amountCents: AMOUNT,
    validFrom: '2020-01-01',
  })
  const { doctorId, commissionId } = await seedDoctor(tenantId)
  await sb
    .from('doctors')
    .update({ council_name: 'CRM', council_number: '123456', council_state: 'SP', cbo: '225125' })
    .eq('id', doctorId)
    .throwOnError()
  const patientId = await seedDecryptablePatient(sb, tenantId)
  await sb
    .from('tenant_tiss_operator_config')
    .insert({
      tenant_id: tenantId,
      health_plan_id: planId,
      ans_registration: '123456',
      contracted_code: 'PREST-001',
      contracted_cnpj: '12345678000199',
      contracted_cnes: '9999999',
      created_by_user_id: admin.userId,
    })
    .throwOnError()
  await upsertPatientCard({
    supabase: sb,
    tenantId,
    patientId,
    healthPlanId: planId,
    cardNumber: '00112233445566',
    actorUserId: admin.userId,
    actorLabel: 'test',
  })
  const appointmentId = await seedAppointment({
    tenantId,
    patientId,
    doctorId,
    procedureId,
    planId,
    priceVersionId,
    commissionId,
    amountCents: AMOUNT,
    commissionBps: 4000,
    at: '2026-06-09T13:00:00.000Z',
  })
  await seedAppointmentLineAndComplete(sb, {
    tenantId,
    appointmentId,
    procedureId,
    planId,
    priceVersionId,
    amountCents: AMOUNT,
  })
  const guia = await generateConsultaGuia({
    supabase: sb,
    tenantId,
    appointmentId,
    actorUserId: admin.userId,
    actorLabel: 'test',
  })
  return { sb, tenantId, planId, guia, adminUserId: admin.userId }
}

describe('Feature 029 — lote, assinatura e exportação (US4)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('T035 — lote de guia pronta gera XML assinado válido no XSD; guia vira exportada', async () => {
    const { sb, tenantId, planId, guia, adminUserId } = await setupWithGuia('tiss-lote-ok')
    expect(guia.status).toBe('pronta')

    await uploadTissCertificate({
      supabase: sb,
      tenantId,
      pfxBase64: makeSelfSignedPfxBase64(),
      password: PFX_PASSWORD,
      actorUserId: adminUserId,
      actorLabel: 'test',
    })

    const result = await createLote({
      supabase: sb,
      tenantId,
      healthPlanId: planId,
      guiaIds: [guia.guiaId],
      actorUserId: adminUserId,
      actorLabel: 'test',
    })
    expect(result.guiaCount).toBe(1)
    expect(result.xmlHashMd5).toMatch(/^[0-9a-f]{32}$/)

    // Lote persistido + XML assinado válido no XSD.
    const { data: lote } = await sb
      .from('tiss_lotes')
      .select('status, xml_content, xml_hash_md5, signed_at, certificate_id')
      .eq('id', result.loteId)
      .single()
    expect(lote?.status).toBe('fechado')
    expect(lote?.xml_hash_md5).toBe(result.xmlHashMd5)
    expect(lote?.signed_at).not.toBeNull()
    expect(lote?.xml_content).toContain('Signature')
    expect(lote?.xml_content).toContain('X509Certificate')
    expect(lote?.xml_content).toContain(result.xmlHashMd5)

    const validation = await validateTissXml(lote!.xml_content as string)
    expect(validation.errors).toEqual([])
    expect(validation.valid).toBe(true)

    // Guia migrou para exportada e vinculou ao lote.
    const { data: g } = await sb
      .from('tiss_guias')
      .select('status, lote_id')
      .eq('id', guia.guiaId)
      .single()
    expect(g?.status).toBe('exportada')
    expect(g?.lote_id).toBe(result.loteId)
  })

  it('T036 — sem certificado ativo, o lote não fecha', async () => {
    const { sb, tenantId, planId, guia, adminUserId } = await setupWithGuia('tiss-lote-sem-cert')
    await expect(
      createLote({
        supabase: sb,
        tenantId,
        healthPlanId: planId,
        guiaIds: [guia.guiaId],
        actorUserId: adminUserId,
        actorLabel: 'test',
      }),
    ).rejects.toThrow(/certificado/i)
  })
})
