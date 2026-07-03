/**
 * Feature 008 — US3: post-connect-setup de Custom Fields no GHL.
 *
 * Cobre:
 *   - Primeira conexão sem campos prévios → cria os 6 (TEXT, TEXT, TEXT,
 *     DATE, LARGE_TEXT, TEXT) e persiste IDs em config.custom_field_ids.
 *   - Reconectar com campos já criados → reusa IDs existentes (sem POST).
 *   - Colisão de tipo (CPF como NUMBER) → cria "CPF (Clinni)" sufixado.
 *   - Falha 5xx no GET inicial → não duplica setups; sync_log marca failure.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant } from '@/tests/helpers/seed-factories'
import { mswServer } from '@/tests/helpers/msw-server'
import { customFieldsSetup } from '@/lib/integrations/ghl/oauth/custom-fields-setup'

interface RemoteField {
  id: string
  name: string
  dataType: string
}

function setupListResponse(locationId: string, fields: RemoteField[]): void {
  mswServer.use(
    http.get(`https://services.leadconnectorhq.com/locations/${locationId}/customFields`, () =>
      HttpResponse.json({ customFields: fields }, { status: 200 }),
    ),
  )
}

function setupCreateResponseFactory(): {
  createCalls: Array<{ name: string; dataType: string }>
  setup: (locationId: string) => void
} {
  const createCalls: Array<{ name: string; dataType: string }> = []
  return {
    createCalls,
    setup(locationId: string) {
      mswServer.use(
        http.post(
          `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
          async ({ request }) => {
            const body = (await request.json()) as { name: string; dataType: string }
            createCalls.push({ name: body.name, dataType: body.dataType })
            return HttpResponse.json(
              { id: `cf_${createCalls.length}_${body.name.replace(/\s+/g, '_').toLowerCase()}` },
              { status: 201 },
            )
          },
        ),
      )
    },
  }
}

describe('US3 — customFieldsSetup', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('Sub-account vazia → cria os 6 fields e persiste IDs', async () => {
    const { tenantId } = await seedTenant('us3-cf-empty')
    const sb = serviceClient()
    // Cria a row tenant_integrations vazia para que updateGhlConfig funcione.
    const { error } = await sb.from('tenant_integrations').insert({
      tenant_id: tenantId,
      provider: 'ghl',
      config: { location_id: 'loc_us3_cf_empty', sub_account_name: 'X' },
      credentials_enc: 'placeholder' as unknown as string,
      enabled: true,
      status: 'connected',
    })
    expect(error).toBeNull()

    setupListResponse('loc_us3_cf_empty', [])
    const create = setupCreateResponseFactory()
    create.setup('loc_us3_cf_empty')

    const result = await customFieldsSetup(sb, tenantId, 'at_xxx', 'loc_us3_cf_empty')

    expect(create.createCalls).toHaveLength(6)
    const names = create.createCalls.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'CPF',
        'Plano de Saúde',
        'Profissional Responsável',
        'Último Atendimento',
        'Diagnósticos Ativos',
        'Alergias',
      ].sort(),
    )
    // CPF e demais string são TEXT; ultimo_atendimento DATE; diagnosticos LARGE_TEXT.
    const cpfCall = create.createCalls.find((c) => c.name === 'CPF')!
    expect(cpfCall.dataType).toBe('TEXT')
    const ultimo = create.createCalls.find((c) => c.name === 'Último Atendimento')!
    expect(ultimo.dataType).toBe('DATE')
    const diag = create.createCalls.find((c) => c.name === 'Diagnósticos Ativos')!
    expect(diag.dataType).toBe('LARGE_TEXT')

    // IDs salvos em config.
    expect(Object.keys(result.ids).sort()).toEqual([
      'alergias',
      'cpf',
      'diagnosticos_ativos',
      'plano_saude',
      'profissional_responsavel',
      'ultimo_atendimento',
    ])

    const persisted = await sb
      .from('tenant_integrations')
      .select('config')
      .eq('tenant_id', tenantId)
      .eq('provider', 'ghl')
      .single()
    const cfIds = (persisted.data?.config as Record<string, unknown>)?.custom_field_ids as Record<
      string,
      { id: string }
    >
    expect(Object.keys(cfIds ?? {}).length).toBe(6)
  })

  it('Sub-account com campos preexistentes (mesmo nome+tipo) → reusa IDs (zero POST)', async () => {
    const { tenantId } = await seedTenant('us3-cf-reuse')
    const sb = serviceClient()
    await sb.from('tenant_integrations').insert({
      tenant_id: tenantId,
      provider: 'ghl',
      config: { location_id: 'loc_us3_cf_reuse', sub_account_name: 'X' },
      credentials_enc: 'placeholder' as unknown as string,
      enabled: true,
      status: 'connected',
    })

    setupListResponse('loc_us3_cf_reuse', [
      { id: 'cf_existing_cpf', name: 'CPF', dataType: 'TEXT' },
      { id: 'cf_existing_plano', name: 'Plano de Saúde', dataType: 'TEXT' },
      { id: 'cf_existing_prof', name: 'Profissional Responsável', dataType: 'TEXT' },
      { id: 'cf_existing_ultimo', name: 'Último Atendimento', dataType: 'DATE' },
      { id: 'cf_existing_diag', name: 'Diagnósticos Ativos', dataType: 'LARGE_TEXT' },
      { id: 'cf_existing_alergias', name: 'Alergias', dataType: 'TEXT' },
    ])
    const create = setupCreateResponseFactory()
    create.setup('loc_us3_cf_reuse')

    const result = await customFieldsSetup(sb, tenantId, 'at_xxx', 'loc_us3_cf_reuse')

    expect(create.createCalls.length).toBe(0)
    expect(result.ids.cpf?.id).toBe('cf_existing_cpf')
    expect(result.ids.diagnosticos_ativos?.id).toBe('cf_existing_diag')
    expect(result.warnings.length).toBe(0)
  })

  it('Colisão de tipo: "CPF" como NUMBER → cria "CPF (Clinni)" sufixado', async () => {
    const { tenantId } = await seedTenant('us3-cf-collision')
    const sb = serviceClient()
    await sb.from('tenant_integrations').insert({
      tenant_id: tenantId,
      provider: 'ghl',
      config: { location_id: 'loc_us3_cf_collision', sub_account_name: 'X' },
      credentials_enc: 'placeholder' as unknown as string,
      enabled: true,
      status: 'connected',
    })

    setupListResponse('loc_us3_cf_collision', [
      { id: 'cf_existing_cpf_number', name: 'CPF', dataType: 'NUMBER' }, // tipo errado
    ])
    const create = setupCreateResponseFactory()
    create.setup('loc_us3_cf_collision')

    const result = await customFieldsSetup(sb, tenantId, 'at_xxx', 'loc_us3_cf_collision')

    // CPF deveria ter sido criado como sufixado.
    const cpfCall = create.createCalls.find((c) => c.name === 'CPF (Clinni)')
    expect(cpfCall).toBeDefined()
    expect(cpfCall?.dataType).toBe('TEXT')
    expect(result.ids.cpf?.id).toContain('cf_')
    expect(result.warnings).toContain('cpf:type_collision_suffixed')
  })

  it('GET inicial 503 → resultado vazio + warning + sync_log failure', async () => {
    const { tenantId } = await seedTenant('us3-cf-list-fail')
    const sb = serviceClient()
    await sb.from('tenant_integrations').insert({
      tenant_id: tenantId,
      provider: 'ghl',
      config: { location_id: 'loc_us3_cf_list_fail', sub_account_name: 'X' },
      credentials_enc: 'placeholder' as unknown as string,
      enabled: true,
      status: 'connected',
    })

    mswServer.use(
      http.get(
        'https://services.leadconnectorhq.com/locations/loc_us3_cf_list_fail/customFields',
        () => new HttpResponse('upstream error', { status: 503 }),
      ),
    )

    const result = await customFieldsSetup(sb, tenantId, 'at_xxx', 'loc_us3_cf_list_fail')
    expect(Object.keys(result.ids).length).toBe(0)
    expect(result.warnings).toContain('custom_fields:list_failed')

    const syncLog = await sb
      .from('integration_sync_log')
      .select('kind, status, error_code')
      .eq('tenant_id', tenantId)
    expect(
      syncLog.data?.some((r) => r.kind === 'custom_field_setup' && r.status === 'failure'),
    ).toBe(true)
  })
})
