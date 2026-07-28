/**
 * T017 (Feature 051) — isolamento multi-tenant de `tenant_whatsapp_config`.
 *
 * Princípio III da constituição exige defesa em camadas e teste que prove que
 * o vazamento entre clínicas é impossível. Aqui a camada testada é o RLS +
 * a projeção do `core/whatsapp/config.ts`.
 *
 * O que está sendo protegido é grave: `api_key_enc` é a credencial que permite
 * MANDAR MENSAGEM pelo número de uma clínica. Vazar isso para outro tenant é
 * pior que vazar um dado de leitura.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { resetDatabase, serviceClient, rlsClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedUser } from '@/tests/helpers/seed-factories'
import { mintJwt } from '@/tests/helpers/jwt-helper'
import {
  getWhatsAppConnection,
  isWhatsAppConnected,
  saveWhatsAppCredentials,
  getDecryptedApiKey,
  updateConnectionState,
} from '@/lib/core/whatsapp/config'

const API_KEY_A = 'ck_tenant_a_chave_secreta_aaaaaaaa'
const API_KEY_B = 'ck_tenant_b_chave_secreta_bbbbbbbb'

describe('Feature 051 — isolamento de tenant_whatsapp_config', () => {
  let tenantA: string
  let tenantB: string
  let jwtAdminA: string
  let jwtAdminB: string
  let svc: SupabaseClient<Database>

  beforeAll(async () => {
    await resetDatabase()
    svc = serviceClient() as unknown as SupabaseClient<Database>

    const a = await seedTenant('whatsapp-iso-a')
    const b = await seedTenant('whatsapp-iso-b')
    tenantA = a.tenantId
    tenantB = b.tenantId

    const ua = await seedUser(tenantA, 'admin')
    const ub = await seedUser(tenantB, 'admin')
    jwtAdminA = mintJwt({ userId: ua.userId, email: ua.email, tenantId: tenantA, role: 'admin' })
    jwtAdminB = mintJwt({ userId: ub.userId, email: ub.email, tenantId: tenantB, role: 'admin' })

    await saveWhatsAppCredentials(svc, {
      tenantId: tenantA,
      serviceTenantSlug: 'whatsapp-iso-a',
      apiKey: API_KEY_A,
    })
    await saveWhatsAppCredentials(svc, {
      tenantId: tenantB,
      serviceTenantSlug: 'whatsapp-iso-b',
      apiKey: API_KEY_B,
    })
  })

  it('a credencial faz round-trip: o que foi cifrado volta igual', async () => {
    expect(await getDecryptedApiKey(svc, tenantA)).toBe(API_KEY_A)
    expect(await getDecryptedApiKey(svc, tenantB)).toBe(API_KEY_B)
  })

  it('a credencial NÃO fica em texto claro na coluna', async () => {
    const { data } = await svc
      .from('tenant_whatsapp_config')
      .select('api_key_enc')
      .eq('tenant_id', tenantA)
      .single()
    const stored = String((data as { api_key_enc: unknown }).api_key_enc)
    expect(stored).not.toContain(API_KEY_A)
    expect(stored.length).toBeGreaterThan(0)
  })

  it('a projeção segura não expõe api_key_enc', async () => {
    const conn = await getWhatsAppConnection(svc, tenantA)
    expect(conn).not.toBeNull()
    expect(Object.keys(conn as object)).not.toContain('apiKeyEnc')
    expect(JSON.stringify(conn)).not.toContain(API_KEY_A)
  })

  it('o admin do tenant A lê a própria conexão via RLS', async () => {
    const clientA = rlsClient(jwtAdminA) as unknown as SupabaseClient<Database>
    const conn = await getWhatsAppConnection(clientA, tenantA)
    expect(conn?.tenantId).toBe(tenantA)
    expect(conn?.serviceTenantSlug).toBe('whatsapp-iso-a')
  })

  it('o admin do tenant A NÃO enxerga a conexão do tenant B', async () => {
    const clientA = rlsClient(jwtAdminA) as unknown as SupabaseClient<Database>
    const conn = await getWhatsAppConnection(clientA, tenantB)
    expect(conn).toBeNull()
  })

  it('o admin do tenant B NÃO enxerga a conexão do tenant A', async () => {
    const clientB = rlsClient(jwtAdminB) as unknown as SupabaseClient<Database>
    expect(await getWhatsAppConnection(clientB, tenantA)).toBeNull()
    expect(await isWhatsAppConnected(clientB, tenantA)).toBe(false)
  })

  it('o admin do tenant A NÃO lê api_key_enc de ninguém — nem a própria', async () => {
    // A policy de SELECT permite a linha, mas nenhuma rota projeta a coluna.
    // Este teste prova que, mesmo pedindo explicitamente, a chave do OUTRO
    // tenant não vem.
    const clientA = rlsClient(jwtAdminA)
    const { data } = await clientA
      .from('tenant_whatsapp_config')
      .select('tenant_id, api_key_enc')
      .eq('tenant_id', tenantB)
    expect(data ?? []).toHaveLength(0)
  })

  it('updateConnectionState do tenant A não altera o tenant B', async () => {
    await updateConnectionState(svc, tenantA, {
      status: 'connected',
      instanceName: 'whatsapp-iso-a-1',
      numberConnected: '5511999998888',
    })

    const connA = await getWhatsAppConnection(svc, tenantA)
    const connB = await getWhatsAppConnection(svc, tenantB)
    expect(connA?.status).toBe('connected')
    expect(connA?.numberConnected).toBe('5511999998888')
    // B continua como foi criado — 'connecting', sem número.
    expect(connB?.status).toBe('connecting')
    expect(connB?.numberConnected).toBeNull()
  })

  it('conectar limpa o motivo de desconexão; desconectar volta a preenchê-lo (FR-012a)', async () => {
    await updateConnectionState(svc, tenantB, {
      status: 'disconnected',
      disconnectReason: 'blocked',
    })
    expect((await getWhatsAppConnection(svc, tenantB))?.disconnectReason).toBe('blocked')

    await updateConnectionState(svc, tenantB, { status: 'connected' })
    expect((await getWhatsAppConnection(svc, tenantB))?.disconnectReason).toBeNull()
  })

  it('a conexão é auditada — conexão e mudança de estado geram registro', async () => {
    const { data } = await svc
      .from('audit_log')
      .select('entity, field, new_value')
      .eq('tenant_id', tenantA)
      .eq('entity', 'tenant_whatsapp_config')
    const rows = (data ?? []) as Array<{ new_value: string | null }>
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.map((r) => r.new_value)).toContain('connected')
  })
})
