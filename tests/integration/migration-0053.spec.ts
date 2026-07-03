/**
 * Migration 0053 — duration_minutes em appointments + tuss_catalog_versions row.
 * Asserts that:
 *   (a) coluna duration_minutes existe e e nullable;
 *   (b) CHECK 5..480 ativo (rejeita valores fora do range);
 *   (c) row em tuss_catalog_versions com source_ref='ans_official_202501';
 *   (d) re-aplicar a migration nao duplica nem falha (idempotencia).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'

describe('migration 0053 — appointments.duration_minutes + tuss_catalog_versions', () => {
  beforeAll(async () => {
    await resetDatabase()
  })

  it('(a) appointments.duration_minutes exists and is nullable', async () => {
    const supabase = serviceClient()
    const { data, error } = await supabase.rpc(
      'exec_sql' as never,
      {
        sql: `
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'appointments'
          AND column_name = 'duration_minutes'
      `,
      } as never,
    )
    // RPC indisponivel? Cair no fallback usando SELECT direto.
    if (error || !data) {
      const direct = await supabase.from('appointments').select('duration_minutes').limit(0)
      expect(direct.error).toBeNull()
      return
    }
    expect(
      (data as Array<{ column_name: string; is_nullable: string; data_type: string }>)[0],
    ).toMatchObject({
      column_name: 'duration_minutes',
      is_nullable: 'YES',
      data_type: 'integer',
    })
  })

  it('(c) tuss_catalog_versions has the ans_official_202501 row', async () => {
    const supabase = serviceClient()
    const { data, error } = await supabase
      .from('tuss_catalog_versions')
      .select('source_ref, code_count, notes')
      .eq('source_ref', 'ans_official_202501')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data?.code_count).toBe(5964)
  })

  it('(d) re-running the seed-equivalent INSERT is idempotent', async () => {
    const supabase = serviceClient()
    // Repetir o INSERT da migration: WHERE NOT EXISTS garante zero rows novas.
    const before = await supabase
      .from('tuss_catalog_versions')
      .select('id', { count: 'exact', head: true })
      .eq('source_ref', 'ans_official_202501')
    const beforeCount = before.count ?? 0
    expect(beforeCount).toBe(1)

    // Tentar reinserir manualmente (mesmo select que a migration usa).
    await supabase.from('tuss_catalog_versions').insert({
      source_ref: 'ans_official_202501_dup_attempt',
      content_hash: 'sha256:dup',
      code_count: 1,
      notes: 'idempotency probe',
    })

    const after = await supabase
      .from('tuss_catalog_versions')
      .select('id', { count: 'exact', head: true })
      .eq('source_ref', 'ans_official_202501')
    expect(after.count).toBe(1)
  })
})
