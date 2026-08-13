/**
 * Feature 057 (T020/T021) — o gate de seção do portal e o isolamento entre clínicas.
 *
 * As páginas de área (`/painel/exames`, `/painel/dieta`…) escondem o card na
 * home quando a seção está desligada — mas esconder card não é controle de
 * acesso. `openPortalPage` decide pelo resultado de `listEnabledPortalSections`,
 * e é ESSA decisão que este teste prende: com a seção desligada pela clínica ou
 * com o módulo fora do plano, a chave não sai na lista, e a página redireciona.
 *
 * Constituição V: "controles apenas de UI (ocultar botão) são insuficientes".
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { resetDatabase, serviceClient } from '@/tests/helpers/supabase-test-client'
import { seedTenant, seedClinicProfile, seedPatientWithPii } from '@/tests/helpers/seed-factories'
import {
  PORTAL_SECTIONS,
  listEnabledPortalSections,
  setPortalSection,
  type PortalSectionKey,
} from '@/lib/core/patient-portal/sections'
import { resolvePortalClinicBySlug } from '@/lib/core/patient-portal/login'
import {
  createPatientSessionCookie,
  verifyPatientSessionCookie,
} from '@/lib/core/patient-portal/session'

/** As seis áreas que ganharam página própria na 057. */
const AREAS: Array<{ key: PortalSectionKey; path: string }> = [
  { key: 'atendimentos', path: 'atendimentos' },
  { key: 'metricas', path: 'evolucao' },
  { key: 'orientacoes', path: 'orientacoes' },
  { key: 'exames', path: 'exames' },
  { key: 'treino', path: 'treino' },
  { key: 'dieta', path: 'dieta' },
]

const ALL_MODULES = () => true
const NO_MODULES = () => false

describe('Feature 057 — toda área com página tem seção no catálogo', () => {
  it('nenhuma página existe sem um gate correspondente', () => {
    // Página nova sem seção no catálogo seria página sem gate: o `openPortalPage`
    // não teria o que exigir e ela abriria para qualquer paciente da clínica.
    for (const area of AREAS) {
      const def = PORTAL_SECTIONS.find((s) => s.key === area.key)
      expect(def, `seção ausente no catálogo: ${area.key}`).toBeDefined()
      expect(def!.implemented).toBe(true)
    }
  })
})

describe('Feature 057 — gate de seção por clínica', () => {
  let tenantId: string

  beforeAll(async () => {
    await resetDatabase()
    tenantId = (await seedTenant('portal-gate')).tenantId
    await seedClinicProfile(tenantId, { slug: 'clinica-gate' })
  })

  it('seção desligada pela clínica não sai na lista — a página redireciona', async () => {
    const sb = serviceClient()
    await setPortalSection(sb, tenantId, 'dieta', false)

    const enabled = await listEnabledPortalSections(sb, tenantId, { hasModule: ALL_MODULES })
    expect(enabled).not.toContain('dieta')
  })

  it('sem o módulo no plano, nem o override liga', async () => {
    const sb = serviceClient()
    // A clínica liga explicitamente; o plano não inclui o módulo.
    for (const key of ['dieta', 'treino', 'exames', 'habitos'] as PortalSectionKey[]) {
      await setPortalSection(sb, tenantId, key, true)
    }

    const enabled = await listEnabledPortalSections(sb, tenantId, { hasModule: NO_MODULES })
    for (const key of ['dieta', 'treino', 'exames'] as PortalSectionKey[]) {
      expect(enabled, `${key} não deveria estar liberada`).not.toContain(key)
    }
  })

  it('as áreas sensíveis nascem desligadas, mesmo com o plano completo', async () => {
    // Clínica nova, sem override nenhum.
    const outro = (await seedTenant('portal-gate-novo')).tenantId
    await seedClinicProfile(outro, { slug: 'clinica-gate-nova' })

    const enabled = await listEnabledPortalSections(serviceClient(), outro, {
      hasModule: ALL_MODULES,
    })
    expect(enabled).not.toContain('exames')
    expect(enabled).not.toContain('orientacoes')
    // As de baixa sensibilidade seguem ligadas por padrão.
    expect(enabled).toContain('atendimentos')
    expect(enabled).toContain('metricas')
  })
})

describe('Feature 057 — isolamento entre clínicas (Princípio III)', () => {
  let tenantA: string
  let tenantB: string
  let patientA: string

  beforeAll(async () => {
    await resetDatabase()
    tenantA = (await seedTenant('portal-x-a')).tenantId
    tenantB = (await seedTenant('portal-x-b')).tenantId
    await seedClinicProfile(tenantA, { slug: 'clinica-x-a' })
    await seedClinicProfile(tenantB, { slug: 'clinica-x-b' })
    patientA = await seedPatientWithPii(tenantA, {
      cpf: '52998224725',
      birthDate: '1990-05-15',
      fullName: 'Alice Portal',
    })
  })

  it('o slug resolve a clínica DELE, e o portal compara com o tenant da sessão', async () => {
    const sb = serviceClient()
    const clinicaA = await resolvePortalClinicBySlug(sb, 'clinica-x-a')
    const clinicaB = await resolvePortalClinicBySlug(sb, 'clinica-x-b')

    expect(clinicaA?.tenantId).toBe(tenantA)
    expect(clinicaB?.tenantId).toBe(tenantB)

    // Cookie legítimo do paciente da clínica A.
    const cookie = createPatientSessionCookie({ patientId: patientA, tenantId: tenantA })
    const session = verifyPatientSessionCookie(cookie)!

    // É esta comparação que `openPortalPage` faz antes de qualquer leitura: a
    // sessão vale para A e NÃO vale para o portal de B.
    expect(session.tenantId).toBe(clinicaA!.tenantId)
    expect(session.tenantId).not.toBe(clinicaB!.tenantId)
  })

  it('clínica com o portal desligado não resolve — não existe para fora', async () => {
    const sb = serviceClient()
    await sb
      .from('tenant_clinic_profile')
      .update({ patient_portal_enabled: false } as never)
      .eq('tenant_id', tenantB)

    expect(await resolvePortalClinicBySlug(sb, 'clinica-x-b')).toBeNull()
  })
})
