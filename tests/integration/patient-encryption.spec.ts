/**
 * T150 / SC-011 — `patients.*_enc` columns are pgcrypto bytea that never
 * leak plaintext.
 *
 * Drives `upsertPatientFromGhl` with distinctive plaintext tokens, reads
 * the ciphertext back, and asserts:
 *   1. every *_enc column deserialises as bytea (hex-prefixed textual form).
 *   2. the raw ciphertext bytes contain none of the plaintext tokens.
 *   3. `dec_text_with_key` recovers the original plaintext (proves the
 *      columns are encrypted payloads, not zero-length stubs).
 *
 * Failing here means a regression introduced a TEXT column or a code path
 * that bypasses `enc_text_with_key` — either of which would violate the
 * LGPD commitment tracked by SC-011.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant } from '@/tests/helpers/seed-factories'
import { upsertPatientFromGhl } from '@/lib/core/patients/upsert-from-ghl'

const ENCRYPTED_COLUMNS = [
  'full_name_enc',
  'cpf_enc',
  'phone_enc',
  'email_enc',
  'birth_date_enc',
] as const

describe('T150 — patients PII columns are encrypted bytea', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('stores PII as pgcrypto ciphertext and never leaks plaintext at rest', async () => {
    const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
    expect(key, 'PATIENT_DATA_ENCRYPTION_KEY must be set for this test').toBeTruthy()

    const { tenantId } = await seedTenant('t150')
    const sb = serviceClient()

    // Distinctive tokens make substring scans unambiguous — even a short
    // CPF has enough entropy that a false positive in random ciphertext is
    // vanishingly unlikely, and the name/email tokens are obviously unique.
    const plain = {
      fullName: 'ZZZUniqueFullNamePatientXYZ',
      cpf: '11122233344',
      phone: '+5511987654321',
      email: 'patient-pii-scan@example.test',
      birthDate: '1988-05-04',
    }

    await upsertPatientFromGhl(sb, {
      tenantId,
      ghlContactId: 'ghl-t150',
      ...plain,
    })

    const { data: row, error } = await sb
      .from('patients')
      .select(ENCRYPTED_COLUMNS.join(', '))
      .eq('tenant_id', tenantId)
      .single()
    expect(error).toBeNull()
    expect(row).toBeTruthy()
    const raw = row as unknown as Record<(typeof ENCRYPTED_COLUMNS)[number], string>

    // 1) Each column is bytea — PostgREST's default textual form is `\x<hex>`.
    //    Any other shape means the migration was changed and the column is
    //    no longer encrypted at rest.
    for (const col of ENCRYPTED_COLUMNS) {
      const value = raw[col]
      expect(value, `${col} is missing`).toBeTruthy()
      expect(value, `${col} is not bytea hex form`).toMatch(/^\\x[0-9a-f]+$/i)
    }

    // 2) No plaintext substring survives in any column's raw bytes.
    const ciphertextBytes = Buffer.concat(
      ENCRYPTED_COLUMNS.map((col) => Buffer.from(raw[col].slice(2), 'hex')),
    )
    const plaintextTokens: Array<[string, string]> = [
      ['fullName', plain.fullName],
      ['cpf', plain.cpf],
      ['phone', plain.phone],
      ['email', plain.email],
      ['birthDate', plain.birthDate],
    ]
    for (const [label, token] of plaintextTokens) {
      expect(
        ciphertextBytes.includes(Buffer.from(token, 'utf8')),
        `ciphertext leaked ${label} ("${token}")`,
      ).toBe(false)
    }

    // 3) Round-trip through dec_text_with_key recovers the plaintext — so we
    //    know the columns are real ciphertext, not zero-length placeholders.
    const decrypted = await Promise.all(
      (
        [
          ['full_name_enc', plain.fullName],
          ['cpf_enc', plain.cpf],
          ['phone_enc', plain.phone],
          ['email_enc', plain.email],
          ['birth_date_enc', plain.birthDate],
        ] as const
      ).map(async ([col, expected]) => {
        const { data, error: decErr } = await sb.rpc('dec_text_with_key', {
          cipher: raw[col],
          key,
        })
        expect(decErr, `dec_text_with_key(${col})`).toBeNull()
        return { col, expected, actual: data }
      }),
    )
    for (const { col, expected, actual } of decrypted) {
      expect(actual, col).toBe(expected)
    }
  })
})
