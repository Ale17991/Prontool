/**
 * Feature 057 (T022) — a trilha de acesso passa a dizer QUAL área foi aberta.
 *
 * Com o portal em várias páginas, uma visita virou cinco ou seis linhas. Sem a
 * coluna `section` seriam cinco `view` idênticos — mais volume carregando a
 * mesma informação, que é o oposto do que uma trilha de LGPD serve para fazer.
 *
 * O outro lado da regra é igualmente importante: as linhas antigas NÃO são
 * retroalimentadas (FR-007a). A tabela é append-only, e `section IS NULL` é o
 * que identifica, sem ambiguidade, o acesso anterior a esta feature.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedClinicProfile, seedPatientWithPii } from '@/tests/helpers/seed-factories'
import { hashIpForPatientPortal, logPatientAccess } from '@/lib/core/patient-portal/audit'

interface LogRow {
  action: string
  section: string | null
}

describe('Feature 057 — área na trilha de acesso do paciente', () => {
  let tenantId: string
  let patientId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('portal-trilha')).tenantId
    await seedClinicProfile(tenantId, { slug: 'clinica-trilha' })
    patientId = await seedPatientWithPii(tenantId, {
      cpf: '52998224725',
      birthDate: '1990-05-15',
      fullName: 'Alice Trilha',
    })
  })

  async function rows(): Promise<LogRow[]> {
    const { data, error } = await serviceClient()
      .from('patient_portal_access_log')
      .select('action, section')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as LogRow[]
  }

  it('grava a área de cada página aberta, mantendo action = view', async () => {
    const sb = serviceClient()
    const ipHash = hashIpForPatientPortal('10.0.0.7', tenantId)

    for (const section of ['home', 'evolucao', 'exames', 'dieta']) {
      await logPatientAccess({ supabase: sb, tenantId, patientId, action: 'view', ipHash, section })
    }

    const all = await rows()
    expect(all).toHaveLength(4)
    expect(all.map((r) => r.section)).toEqual(['home', 'evolucao', 'exames', 'dieta'])
    // A dimensão "o que a pessoa fez" não mudou: continua `view` para todas.
    expect(new Set(all.map((r) => r.action))).toEqual(new Set(['view']))
  })

  it('ação que não é navegação continua sem área', async () => {
    const sb = serviceClient()
    const ipHash = hashIpForPatientPortal('10.0.0.7', tenantId)
    await logPatientAccess({ supabase: sb, tenantId, patientId, action: 'login_ok', ipHash })

    const login = (await rows()).find((r) => r.action === 'login_ok')
    expect(login).toBeDefined()
    // Login não acontece "numa área" — forçar um rótulo aqui seria inventar dado.
    expect(login!.section).toBeNull()
  })

  it('linha gravada sem área permanece nula — o passado não se reescreve', async () => {
    const sb = serviceClient()
    const ipHash = hashIpForPatientPortal('10.0.0.7', tenantId)

    // Simula o registro anterior à 057: `view` sem seção.
    await logPatientAccess({ supabase: sb, tenantId, patientId, action: 'view', ipHash })
    const antes = (await rows()).filter((r) => r.action === 'view' && r.section === null)
    expect(antes.length).toBeGreaterThan(0)

    // Uma navegação nova não retroalimenta as antigas.
    await logPatientAccess({
      supabase: sb,
      tenantId,
      patientId,
      action: 'view',
      ipHash,
      section: 'treino',
    })
    const depois = (await rows()).filter((r) => r.action === 'view' && r.section === null)
    expect(depois.length).toBe(antes.length)
  })
})
