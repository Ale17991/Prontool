/**
 * Feature 056 — T057: entrega e leitura chegam até a automação.
 *
 * O que este arquivo trava é um defeito que existia calado. O motor manda o id
 * da OCORRÊNCIA como `externalId`; o serviço devolve a confirmação com esse id;
 * a rota de callback procurava só em `appointment_reminders`, não achava, e
 * respondia 200 com `ignored`. Toda confirmação de automação era descartada, e
 * a clínica veria "enviada" para sempre — sem jamais saber se chegou.
 *
 * O segundo bloco protege a fronteira oposta: a taxa de leitura de LEMBRETE
 * (SC-004 da 051) não pode ser diluída por mensagem de automação. As duas
 * dividem tabela desde a 0197, e é só o filtro que as mantém medindo coisas
 * diferentes.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant } from '@/tests/helpers/seed-factories'
import { saveWhatsAppCredentials } from '@/lib/core/whatsapp/config'
import { getAutomationMetrics } from '@/lib/core/automations/metrics'
import { getWhatsAppReadRate } from '@/lib/core/whatsapp/metrics'

const sb = serviceClient() as unknown as SupabaseClient<Database>
const SEGREDO = 'cs_segredo_de_callback_automacao'

async function enc(plain: string): Promise<string> {
  const { data, error } = await sb.rpc('enc_text_with_key', {
    plain,
    key: process.env.PATIENT_DATA_ENCRYPTION_KEY as string,
  })
  if (error) throw new Error(error.message)
  return data as unknown as string
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

describe('Feature 056 — confirmação de entrega de automação', () => {
  let tenantId = ''
  let automationId = ''
  let ocorrenciaEnviada = ''
  let ocorrenciaLida = ''

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('auto-entrega')).tenantId

    await saveWhatsAppCredentials(sb, {
      tenantId,
      serviceTenantSlug: 'auto-entrega',
      apiKey: 'ck_auto',
      callbackSecret: SEGREDO,
    })

    const patientId = randomUUID()
    await sb
      .from('patients')
      .insert({
        id: patientId,
        tenant_id: tenantId,
        full_name_enc: await enc('Maria'),
        phone_enc: await enc('5527988887777'),
        status: 'ativo',
        automations_opt_in: true,
      } as never)
      .throwOnError()

    const { data: msg } = await sb
      .from('message_templates' as never)
      .insert({ tenant_id: tenantId, name: 'M', body: 'Olá, {{paciente}}' } as never)
      .select('id')
      .single()
    const { data: gat } = await sb
      .from('automation_triggers' as never)
      .insert({ tenant_id: tenantId, name: 'G', source: 'aniversario', params: {} } as never)
      .select('id')
      .single()
    const { data: auto } = await sb
      .from('automations' as never)
      .insert({
        tenant_id: tenantId,
        name: `Auto ${(gat as unknown as { id: string }).id.slice(0, 8)}`,
        trigger_id: (gat as unknown as { id: string }).id,
        message_template_id: (msg as unknown as { id: string }).id,
        active: true,
      } as never)
      .select('id')
      .single()
    automationId = (auto as unknown as { id: string }).id

    const criar = async (chave: string) => {
      const { data } = await sb
        .from('automation_occurrences' as never)
        .insert({
          tenant_id: tenantId,
          automation_id: automationId,
          patient_id: patientId,
          occurrence_key: chave,
          outcome: 'pendente',
        } as never)
        .select('id')
        .single()
      const id = (data as unknown as { id: string }).id
      await sb
        .from('automation_occurrences' as never)
        .update({ outcome: 'enviado' } as never)
        .eq('id', id)
        .throwOnError()
      return id
    }
    ocorrenciaEnviada = await criar('2026-08-11')
    ocorrenciaLida = await criar('2026-08-12')
  })

  it('o callback reconhece o id da OCORRÊNCIA e grava o evento', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const res = await POST(
      requisicao({ externalId: ocorrenciaEnviada, status: 'delivered' }, SEGREDO),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const { data } = await sb
      .from('whatsapp_delivery_events')
      .select('status, reminder_id, tenant_id')
      .eq('automation_occurrence_id', ocorrenciaEnviada)
    const evs = (data ?? []) as Array<{
      status: string
      reminder_id: string | null
      tenant_id: string
    }>
    expect(evs).toHaveLength(1)
    expect(evs[0]?.status).toBe('delivered')
    // O CHECK da 0197: exatamente UMA das duas referências.
    expect(evs[0]?.reminder_id).toBeNull()
    // O tenant sai da ocorrência, nunca do corpo (Princípio III).
    expect(evs[0]?.tenant_id).toBe(tenantId)
  })

  it('sem Bearer, a confirmação de automação também é recusada', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const res = await POST(requisicao({ externalId: ocorrenciaLida, status: 'read' }))
    expect(res.status).toBe(401)

    const { count } = await sb
      .from('whatsapp_delivery_events')
      .select('*', { count: 'exact', head: true })
      .eq('automation_occurrence_id', ocorrenciaLida)
    expect(count).toBe(0)
  })

  it('as métricas por automação são derivadas dos eventos, e leitura implica entrega', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    // Só `read`, sem `delivered` antes: a Evolution nem sempre emite os dois
    // ACKs, e exigir o `delivered` explícito jogaria fora leitura confirmada.
    await POST(requisicao({ externalId: ocorrenciaLida, status: 'read' }, SEGREDO))

    const m = await getAutomationMetrics(sb as never, tenantId, '2000-01-01T00:00:00.000Z')
    const auto = m.get(automationId)
    expect(auto?.enviados).toBe(2)
    expect(auto?.entregues).toBe(2)
    expect(auto?.lidos).toBe(1)
  })

  it('a taxa de leitura de LEMBRETE ignora os eventos de automação', async () => {
    // Nenhum lembrete foi semeado nesta clínica; só automação. Se o filtro de
    // `reminder_id IS NOT NULL` sumisse, os eventos acima entrariam aqui e a
    // clínica veria uma taxa de lembrete que nunca existiu.
    const r = await getWhatsAppReadRate(sb, tenantId, {
      since: '2000-01-01T00:00:00.000Z',
      until: '2100-01-01T00:00:00.000Z',
    })
    expect(r.entregues).toBe(0)
    expect(r.taxa).toBeNull()
  })

  /**
   * Estes dois travam o defeito de 24/08/2026. O envio demorava mais que o
   * timeout do cliente, a função morria antes de gravar o desfecho, e a
   * ocorrência ficava `pendente` para sempre — enquanto a mensagem tinha sido
   * ENTREGUE E LIDA, com os dois eventos gravados aqui do lado. O histórico da
   * clínica contradizia a prova que ela mesma guardava.
   */
  async function ocorrenciaPendente(chave: string): Promise<string> {
    const { data: pac } = await sb
      .from('patients')
      .select('id')
      .eq('tenant_id', tenantId)
      .limit(1)
      .single()
    const { data } = await sb
      .from('automation_occurrences' as never)
      .insert({
        tenant_id: tenantId,
        automation_id: automationId,
        patient_id: (pac as unknown as { id: string }).id,
        occurrence_key: chave,
        outcome: 'pendente',
      } as never)
      .select('id')
      .single()
    return (data as unknown as { id: string }).id
  }

  async function desfecho(id: string) {
    const { data } = await sb
      .from('automation_occurrences' as never)
      .select('outcome, provider_message_id')
      .eq('id', id)
      .single()
    return data as unknown as { outcome: string; provider_message_id: string | null }
  }

  it('a confirmação FECHA a ocorrência que ficou pendente, e guarda a correlação', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const id = await ocorrenciaPendente('2026-08-24')

    const res = await POST(
      requisicao({ externalId: id, status: 'delivered', messageId: 'msg-abc' }, SEGREDO),
    )
    expect(res.status).toBe(200)

    const d = await desfecho(id)
    expect(d.outcome).toBe('enviado')
    expect(d.provider_message_id).toBe('msg-abc')
  })

  it('ACK de erro NÃO fecha a ocorrência — falha de entrega não é falha de envio', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp-status/route')
    const id = await ocorrenciaPendente('2026-08-25')

    const res = await POST(
      requisicao({ externalId: id, status: 'error', error: 'sem whatsapp' }, SEGREDO),
    )
    expect(res.status).toBe(200)

    // Continua pendente: marcar `falhou` a reabriria para retentativa (0203) e
    // reenviaria uma mensagem que pode já ter saído.
    expect((await desfecho(id)).outcome).toBe('pendente')
  })
})
