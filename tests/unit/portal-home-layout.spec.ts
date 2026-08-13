/**
 * Feature 057 (T009/T010/T011/T030) — o que a tela inicial do portal mostra.
 *
 * Cobre as três user stories na camada onde a regra vive: a home enxuta (US1),
 * a promoção quando ela ficaria vazia, e o card apagado da área sem conteúdo
 * (US3). O gate de seção por URL é da US2 e mora no guard, não aqui.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { buildPortalHome } from '@/lib/core/patient-portal/home-layout'
import type { PortalSectionKey } from '@/lib/core/patient-portal/sections'
import type { PatientPortalBundle } from '@/lib/core/patient-portal/read-portal'

beforeAll(() => {
  process.env.CLINIC_TIMEZONE ??= 'America/Sao_Paulo'
})

const NOW = Date.parse('2026-08-13T12:00:00-03:00')

function bundle(over: Partial<PatientPortalBundle> = {}): PatientPortalBundle {
  return {
    patient: { firstName: 'Ana' },
    weightImc: [],
    metrics: {},
    metricTypes: [],
    appointments: [],
    careNotes: [],
    goals: [],
    workout: null,
    diet: null,
    labResults: null,
    ...over,
  } as PatientPortalBundle
}

const on = (...keys: PortalSectionKey[]) => new Set<PortalSectionKey>(keys)

const goal = () => ({ metricType: 'peso_kg', targetValue: 70 }) as never
const appt = (iso: string) => ({ id: iso, appointmentAt: iso, doctorName: null, procedureName: null, status: 'agendado' })
const note = (iso: string) => ({ id: iso, body: 'Beba água', createdAt: iso })

const build = (args: Partial<Parameters<typeof buildPortalHome>[0]> = {}) =>
  buildPortalHome({
    enabled: on(),
    bundle: bundle(),
    hasChecklist: false,
    welcomeText: null,
    nowMs: NOW,
    ...args,
  })

describe('US1 — a home só abre metas e checklist', () => {
  it('com metas e checklist, tudo o mais é card', () => {
    const home = build({
      enabled: on('metas', 'habitos', 'metricas', 'dieta'),
      bundle: bundle({ goals: [goal()], diet: { title: 'Plano A', meals: [] } as never }),
      hasChecklist: true,
    })

    expect(home.showGoals).toBe(true)
    expect(home.showHabitos).toBe(true)
    // Nada é promovido: a home já tem conteúdo próprio.
    expect(home.promoted).toBeNull()
    expect(home.cards.map((c) => c.key)).toEqual(['metricas', 'dieta'])
  })

  it('seção desligada não vira card', () => {
    const home = build({ enabled: on('metas', 'metricas'), bundle: bundle({ goals: [goal()] }) })
    expect(home.cards.map((c) => c.key)).toEqual(['metricas'])
  })

  it('a ordem é a do catálogo, não a ordem em que a clínica ligou', () => {
    const home = build({
      enabled: on('metas', 'dieta', 'atendimentos', 'exames', 'metricas'),
      bundle: bundle({ goals: [goal()] }),
    })
    expect(home.cards.map((c) => c.key)).toEqual(['atendimentos', 'metricas', 'exames', 'dieta'])
  })

  it('meta cadastrada mas seção desligada não abre nada', () => {
    const home = build({ enabled: on('metricas'), bundle: bundle({ goals: [goal()] }) })
    expect(home.showGoals).toBe(false)
  })

  it('hábitos ligados SEM checklist montado contam como "sem hábitos"', () => {
    const home = build({ enabled: on('habitos'), hasChecklist: false })
    expect(home.showHabitos).toBe(false)
  })
})

describe('US1 — próxima consulta no cabeçalho', () => {
  const futura = '2026-08-14T18:00:00Z' // 15h em São Paulo
  const passada = '2026-08-01T13:00:00Z'

  it('mostra a consulta futura mais próxima, no fuso da clínica', () => {
    // A lista chega decrescente, como vem de `listPortalAppointments`.
    const home = build({
      enabled: on('atendimentos'),
      bundle: bundle({ appointments: [appt('2026-09-20T18:00:00Z'), appt(futura), appt(passada)] }),
    })
    expect(home.nextAppointment).toBe('14/08 às 15h')
  })

  it('sem consulta futura, não anuncia a ausência', () => {
    const home = build({
      enabled: on('atendimentos'),
      bundle: bundle({ appointments: [appt(passada)] }),
    })
    expect(home.nextAppointment).toBeNull()
  })

  it('com a área de atendimentos desligada, a linha some', () => {
    // Senão o cabeçalho contornaria a decisão da clínica.
    const home = build({ enabled: on('metas'), bundle: bundle({ appointments: [appt(futura)] }) })
    expect(home.nextAppointment).toBeNull()
  })

  it('minuto quebrado aparece; hora cheia não mostra ":00"', () => {
    const home = build({
      enabled: on('atendimentos'),
      bundle: bundle({ appointments: [appt('2026-08-14T18:30:00Z')] }),
    })
    expect(home.nextAppointment).toBe('14/08 às 15h30')
  })
})

describe('US1 — promoção quando a home ficaria vazia', () => {
  const comDieta = bundle({ diet: { title: 'Plano A', meals: [] } as never })

  it('sem metas e sem checklist, sobe a primeira área COM conteúdo', () => {
    const home = build({ enabled: on('metas', 'habitos', 'treino', 'dieta'), bundle: comDieta })
    // Treino está ligado mas vazio: quem sobe é a dieta.
    expect(home.promoted).toBe('dieta')
  })

  it('a área promovida NÃO aparece também como card', () => {
    const home = build({ enabled: on('treino', 'dieta'), bundle: comDieta })
    expect(home.promoted).toBe('dieta')
    expect(home.cards.map((c) => c.key)).toEqual(['treino'])
  })

  it('respeita a ordem do catálogo ao escolher quem sobe', () => {
    const home = build({
      enabled: on('atendimentos', 'dieta'),
      bundle: bundle({
        appointments: [appt('2026-08-01T13:00:00Z')],
        diet: { title: 'Plano A', meals: [] } as never,
      }),
    })
    expect(home.promoted).toBe('atendimentos')
  })

  it('volta ao normal assim que existe uma meta', () => {
    const home = build({
      enabled: on('metas', 'dieta'),
      bundle: bundle({ goals: [goal()], diet: { title: 'Plano A', meals: [] } as never }),
    })
    expect(home.promoted).toBeNull()
    expect(home.cards.map((c) => c.key)).toEqual(['dieta'])
  })

  it('o recado da clínica aparece junto da área promovida', () => {
    const home = build({
      enabled: on('dieta'),
      bundle: comDieta,
      welcomeText: 'Que bom ter você aqui!',
    })
    expect(home.showWelcome).toBe(true)
    expect(home.promoted).toBe('dieta')
  })

  it('o recado NÃO aparece para quem tem metas — não é mural', () => {
    const home = build({
      enabled: on('metas'),
      bundle: bundle({ goals: [goal()] }),
      welcomeText: 'Que bom ter você aqui!',
    })
    expect(home.showWelcome).toBe(false)
  })

  it('sem recado e sem área com conteúdo, a home se declara vazia', () => {
    const home = build({ enabled: on('treino') })
    expect(home.promoted).toBeNull()
    // O card apagado ainda existe, então há o que mostrar.
    expect(home.hasAnything).toBe(true)

    const nada = build({ enabled: on() })
    expect(nada.hasAnything).toBe(false)
  })
})

describe('US3 — área ligada e vazia', () => {
  it('vira card apagado, com o motivo, e não é promovida', () => {
    const home = build({ enabled: on('treino', 'orientacoes') })
    const treino = home.cards.find((c) => c.key === 'treino')!
    expect(treino.empty).toBe(true)
    expect(treino.emptyHint).toContain('ainda não cadastrou')
    expect(home.promoted).toBeNull()
  })

  it('card com conteúdo traz prévia', () => {
    const home = build({
      enabled: on('metas', 'orientacoes', 'atendimentos'),
      bundle: bundle({
        goals: [goal()],
        careNotes: [note('2026-08-10T12:00:00Z'), note('2026-08-09T12:00:00Z')],
        appointments: [appt('2026-08-20T18:00:00Z')],
      }),
    })
    expect(home.cards.find((c) => c.key === 'orientacoes')!.hint).toBe('2 orientações da equipe')
    expect(home.cards.find((c) => c.key === 'atendimentos')!.hint).toBe('Próxima em 20/08/2026')
  })

  it('sem consulta futura, a prévia fala do último atendimento', () => {
    const home = build({
      enabled: on('metas', 'atendimentos'),
      bundle: bundle({ goals: [goal()], appointments: [appt('2026-08-01T13:00:00Z')] }),
    })
    expect(home.cards.find((c) => c.key === 'atendimentos')!.hint).toBe('Último em 01/08/2026')
  })
})
