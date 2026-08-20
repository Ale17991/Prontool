/**
 * T038 (Feature 051) — contrato da rota de confirmação de entrega.
 *
 * O que está sendo protegido: sem autenticação, qualquer um forja "entregue" ou
 * "lida" no histórico da clínica — e o histórico é justamente o que ela usa
 * para confiar no canal. FR-020 exige descartar confirmação não autenticada.
 *
 * O outro ponto crítico é o Princípio III: o `tenant_id` sai do LEMBRETE, nunca
 * do corpo da requisição. Quem manda o payload não escolhe em qual clínica
 * escreve.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import {
  seedTenant,
  seedTussCode,
  seedProcedure,
  seedHealthPlan,
  seedDoctor,
  seedPriceVersion,
  seedPatient,
  seedAppointment,
} from '@/tests/helpers/seed-factories'
import { saveWhatsAppCredentials } from '@/lib/core/whatsapp/config'

const TUSS = '10101012'
const SEGREDO = 'cs_segredo_de_callback_do_tenant_a'
const SEGREDO_B = 'cs_segredo_de_callback_do_tenant_b'

const sb = serviceClient() as unknown as SupabaseClient<Database>

async function seedLembrete(tenantId: string, slug: string): Promise<string> {
  await seedTussCode(TUSS)
  const procedureId = await seedProcedure(tenantId, TUSS)
  const planId = await seedHealthPlan(tenantId, 'Unimed')
  const { doctorId, commissionId } = await seedDoctor(tenantId, { bps: 4000, crm: `CRM-${slug}` })
  const priceVersionId = await seedPriceVersion({
    tenantId,
    procedureId,
    planId,
    amountCents: 20_000,
    validFrom: '2020-01-01',
  })
  const patientId = await seedPatient(tenantId)
  const appointmentId = await seedAppointment({
    tenantId,
    patientId,
    doctorId,
    procedureId,
    planId,
    priceVersionId,
    commissionId,
    amountCents: 20_000,
    commissionBps: 4000,
  })

  const { data, error } = await sb
    .from('appointment_reminders')
    .insert({
      tenant_id: tenantId,
      appointment_id: appointmentId,
      scheduled_offset_hours: 24,
      channel: 'whatsapp',
      status: 'queued',
      is_manual: false,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

function requisicao(body: unknown, bearer?: string): Request {
  return new Request('http://localhost/api/webhooks/whatsapp-status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function eventos(reminderId: string) {
  const { data } = await sb
    .from('whatsapp_delivery_events')
    .select('status, tenant_id')
    .eq('reminder_id', reminderId)
  return (data ?? []) as Array<{ status: string; tenant_id: string }>
}

describe('Feature 051 — POST /api/webhooks/whatsapp-status', () => {
  let tenantA = ''
  let tenantB = ''
  let lembreteA = ''

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('cb-a')).tenantId
    tenantB = (await seedTenant('cb-b')).tenantId

    await saveWhatsAppCredentials(sb, {
      tenantId: tenantA,
      serviceTenantSlug: 'cb-a',
      apiKey: 'ck_a',
      callbackSecret: SEGREDO,
    })
    await saveWhatsAppCredentials(sb, {
      tenantId: tenantB,
      serviceTenantSlug: 'cb-b',
      apiKey: 'ck_b',
      callbackSecret: SEGREDO_B,
    })

    lembreteA = await seedLembrete(tenantA, 'a')
  })

  it('sem Bearer → 401 e NADA é gravado (FR-020)', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const res = await POST(requisicao({ externalId: lembreteA, status: 'delivered' }))
    expect(res.status).toBe(401)
    expect(await eventos(lembreteA)).toHaveLength(0)
  })

  it('Bearer errado → 401 e NADA é gravado', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const res = await POST(
      requisicao({ externalId: lembreteA, status: 'delivered' }, 'segredo-errado'),
    )
    expect(res.status).toBe(401)
    expect(await eventos(lembreteA)).toHaveLength(0)
  })

  it('o segredo de OUTRA clínica não serve — o segredo é por tenant', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const res = await POST(requisicao({ externalId: lembreteA, status: 'read' }, SEGREDO_B))
    expect(res.status).toBe(401)
    expect(await eventos(lembreteA)).toHaveLength(0)
  })

  it('Bearer correto → 200 e o evento é gravado no tenant DO LEMBRETE', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const res = await POST(requisicao({ externalId: lembreteA, status: 'delivered' }, SEGREDO))
    expect(res.status).toBe(200)

    const evs = await eventos(lembreteA)
    expect(evs).toHaveLength(1)
    expect(evs[0]?.status).toBe('delivered')
    expect(evs[0]?.tenant_id).toBe(tenantA)
  })

  it('tenant_id do CORPO é ignorado — quem manda não escolhe onde escreve', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const res = await POST(
      requisicao(
        { externalId: lembreteA, status: 'read', tenantId: tenantB, tenant_id: tenantB },
        SEGREDO,
      ),
    )
    expect(res.status).toBe(200)

    const evs = await eventos(lembreteA)
    // Todos no tenant A, apesar do corpo pedir o B.
    expect(evs.every((e) => e.tenant_id === tenantA)).toBe(true)
  })

  it('externalId desconhecido → 200 sem efeito (4xx faria o serviço re-tentar em loop)', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const res = await POST(requisicao({ externalId: randomUUID(), status: 'read' }, SEGREDO))
    expect(res.status).toBe(200)
  })

  it('status fora do domínio é ignorado sem gravar', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const antes = (await eventos(lembreteA)).length
    const res = await POST(requisicao({ externalId: lembreteA, status: 'inventado' }, SEGREDO))
    expect(res.status).toBe(200)
    expect(await eventos(lembreteA)).toHaveLength(antes)
  })

  it('a mesma confirmação duas vezes gera duas linhas — a tabela é um log', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const antes = (await eventos(lembreteA)).length
    const payload = { externalId: lembreteA, status: 'read', timestamp: '2026-08-10T12:00:00Z' }
    await POST(requisicao(payload, SEGREDO))
    await POST(requisicao(payload, SEGREDO))
    // Deduplicar na escrita esconderia retentativa em loop, que é sinal útil.
    expect(await eventos(lembreteA)).toHaveLength(antes + 2)
  })

  it('o telefone do paciente NÃO é persistido (LGPD)', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    await POST(
      requisicao({ externalId: lembreteA, status: 'delivered', to: '5511999998888' }, SEGREDO),
    )
    const { data } = await sb
      .from('whatsapp_delivery_events')
      .select('*')
      .eq('reminder_id', lembreteA)
    expect(JSON.stringify(data)).not.toContain('5511999998888')
  })
})
