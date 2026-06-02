/**
 * T028 (Feature 027 / FR-011) — credenciais Memed cifradas em repouso.
 *
 * Prova que o que vai para a coluna (`enc_text_with_key`) é ciphertext (≠ valor
 * original) e que só `dec_text_with_key` com a chave correta recupera o
 * plaintext. SELECT direto jamais devolve o segredo em claro.
 */
import { describe, it, expect } from 'vitest'
import { serviceClient } from '@/tests/helpers/supabase-test-client'

describe('Feature 027 — credenciais Memed cifradas em repouso', () => {
  it('enc_text_with_key produz ciphertext ≠ plaintext e dec recupera', async () => {
    const sb = serviceClient()
    const apiKey = 'mk_homolog_abc123def456ghi789'
    const key = 'chave-de-teste-32-bytes-xxxxxxxxxx'

    const { data: cipher, error: encErr } = await sb.rpc('enc_text_with_key', {
      plain: apiKey,
      key,
    })
    expect(encErr).toBeNull()
    const cipherStr = String(cipher)
    // Ciphertext não contém o segredo em claro.
    expect(cipherStr).not.toContain(apiKey)
    expect(cipherStr.length).toBeGreaterThan(0)

    // Decifra com a chave certa.
    const { data: plain, error: decErr } = await sb.rpc('dec_text_with_key', {
      cipher: cipherStr,
      key,
    })
    expect(decErr).toBeNull()
    expect(plain).toBe(apiKey)
  })

  it('dec com chave errada NÃO devolve o plaintext', async () => {
    const sb = serviceClient()
    const secret = 'sk_homolog_zyx987wvu654'
    const { data: cipher } = await sb.rpc('enc_text_with_key', {
      plain: secret,
      key: 'chave-correta-aaaaaaaaaaaaaaaaaaaa',
    })
    const { data: plain, error } = await sb.rpc('dec_text_with_key', {
      cipher: String(cipher),
      key: 'chave-ERRADA-bbbbbbbbbbbbbbbbbbbbb',
    })
    // pgcrypto rejeita a chave errada (erro) ou não devolve o segredo.
    expect(error !== null || plain !== secret).toBe(true)
    if (plain) expect(plain).not.toBe(secret)
  })
})
